/**
 * Client-side inventory store, backed by Neon through server functions.
 *
 * There is no mock data here. Everything comes from the database via
 * `src/lib/stock-api.ts`; this module is a cache plus a small amount of edit
 * state, and it deliberately keeps the same shape the page components already
 * consume.
 *
 * Two behaviours worth knowing:
 *
 * 1. `updateOperation` is fire-and-forget. Document fields are edited on every
 *    keystroke, so the patch is applied locally at once and written to the
 *    server on a short debounce. Without that, typing a supplier name would
 *    issue one request per character.
 *
 * 2. `validateReceipt` flushes any outstanding debounced edit before it runs.
 *    Otherwise a received quantity typed moments earlier could still be in
 *    flight and would not be counted.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuth } from './auth';

import {
  applyAdjustment as applyAdjustmentFn,
  createCategory as createCategoryFn,
  createLocation as createLocationFn,
  createProduct as createProductFn,
  createReceipt as createReceiptFn,
  createWarehouse as createWarehouseFn,
  getSnapshot,
  saveReorderingRule as saveReorderingRuleFn,
  updateOperation as updateOperationFn,
  validateOperation,
  type LocationDto,
  type QuantDto,
  type WarehouseDto,
} from '@/lib/stock-api';

export type { LocationDto, QuantDto, WarehouseDto };

export type AdjustmentReason = 'Damaged' | 'Lost' | 'Found' | 'Miscount' | 'Other';

export type NewProductInput = {
  name: string;
  sku: string;
  category: string;
  unit: string;
  initialStock?: number;
  location?: string;
  minQty?: number;
  maxQty?: number;
};

export type Status = 'Draft' | 'Waiting' | 'Ready' | 'Done' | 'Canceled';
export type Kind = 'Receipt' | 'Delivery' | 'Internal Transfer' | 'Adjustment';
/** Mirrors the database enum. Admin inherits every Inventory Manager right. */
export type Role = 'Warehouse Staff' | 'Inventory Manager' | 'Admin';

export type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  onHand: number;
  minimum: number;
  maximum: number;
  location: string;
};

export type Line = { productId: string; demand: number; received: number };

export type Operation = {
  id: string;
  kind: Kind;
  status: Status;
  partner: string;
  date: string;
  location: string;
  source: string;
  lines: Line[];
};

export type Move = {
  id: string;
  date: string;
  reference: string;
  productId: string;
  from: string;
  to: string;
  quantity: number;
  kind: Kind;
  status: Status;
  by: string;
};

type Store = {
  products: Product[];
  operations: Operation[];
  moves: Move[];
  categories: string[];
  locations: string[];
  warehouses: WarehouseDto[];
  locationRows: LocationDto[];
  /** Real per-location on-hand rows. A product may appear more than once. */
  quants: QuantDto[];
  isLoading: boolean;
  /** The signed-in user's role. Comes from the database, not a demo switcher. */
  role: Role;
  updateOperation: (id: string, patch: Partial<Operation>) => void;
  createReceipt: () => Promise<string>;
  validateReceipt: (id: string) => Promise<void>;
  applyAdjustment: (
    counts: Record<string, number>,
    reasons: Record<string, AdjustmentReason>,
    note?: string,
  ) => Promise<number>;
  createProduct: (input: NewProductInput) => Promise<void>;
  createCategory: (name: string) => Promise<void>;
  saveReorderingRule: (productId: string, minQty: number, maxQty: number) => Promise<void>;
  createWarehouse: (input: { name: string; code: string; address?: string }) => Promise<void>;
  createLocation: (warehouseCode: string, name: string) => Promise<void>;
};

const SNAPSHOT_KEY = ['stock', 'snapshot'] as const;

/** How long to wait after the last keystroke before persisting a document edit. */
const WRITE_DELAY_MS = 400;

const StockContext = createContext<Store | null>(null);

/** Narrow a local patch down to the fields the server accepts. */
function toWirePatch(patch: Partial<Operation>) {
  return {
    ...(patch.partner !== undefined && { partner: patch.partner }),
    ...(patch.date !== undefined && { date: patch.date }),
    ...(patch.location !== undefined && { location: patch.location }),
    ...(patch.source !== undefined && { source: patch.source }),
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.lines !== undefined && { lines: patch.lines }),
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export function StockProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role: Role = user?.role ?? 'Warehouse Staff';

  const query = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => getSnapshot(),
    // Don't ask the server for inventory before anyone is signed in.
    enabled: user !== null,
  });

  // Edits not yet written to the server, keyed by document reference. Held in a
  // ref so the debounce callback always sees the newest value, with a counter
  // to drive re-renders.
  const pending = useRef(new Map<string, Partial<Operation>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY }),
    [queryClient],
  );

  const flush = useCallback(
    async (reference: string): Promise<void> => {
      const timer = timers.current.get(reference);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(reference);
      }

      const patch = pending.current.get(reference);
      if (!patch) return;

      try {
        await updateOperationFn({ data: { reference, patch: toWirePatch(patch) } });
        pending.current.delete(reference);
        await refresh();
      } catch (error) {
        // Keep the patch so the user's typing is not silently discarded.
        toast.error(describe(error));
      } finally {
        bump();
      }
    },
    [bump, refresh],
  );

  const updateOperation = useCallback(
    (id: string, patch: Partial<Operation>) => {
      pending.current.set(id, { ...pending.current.get(id), ...patch });
      bump();

      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        id,
        setTimeout(() => {
          void flush(id);
        }, WRITE_DELAY_MS),
      );
    },
    [bump, flush],
  );

  const createReceipt = useCallback(async (): Promise<string> => {
    const reference = await createReceiptFn();
    await refresh();
    return reference;
  }, [refresh]);

  const validateReceipt = useCallback(
    async (id: string): Promise<void> => {
      // Persist anything still debounced, or those quantities would be missed.
      await flush(id);
      await validateOperation({ data: { reference: id } });
      await refresh();
    },
    [flush, refresh],
  );

  const applyAdjustment = useCallback(
    async (
      counts: Record<string, number>,
      reasons: Record<string, AdjustmentReason>,
      note?: string,
    ): Promise<number> => {
      const changed = await applyAdjustmentFn({
        data: { counts, reasons, ...(note !== undefined && { note }) },
      });
      await refresh();
      return changed;
    },
    [refresh],
  );

  const createProduct = useCallback(
    async (input: NewProductInput): Promise<void> => {
      await createProductFn({ data: input });
      await refresh();
    },
    [refresh],
  );

  const createCategory = useCallback(
    async (name: string): Promise<void> => {
      await createCategoryFn({ data: { name } });
      await refresh();
    },
    [refresh],
  );

  const saveReorderingRule = useCallback(
    async (productId: string, minQty: number, maxQty: number): Promise<void> => {
      await saveReorderingRuleFn({ data: { productId, minQty, maxQty } });
      await refresh();
    },
    [refresh],
  );

  const createWarehouse = useCallback(
    async (input: { name: string; code: string; address?: string }): Promise<void> => {
      await createWarehouseFn({ data: input });
      await refresh();
    },
    [refresh],
  );

  const createLocation = useCallback(
    async (warehouseCode: string, name: string): Promise<void> => {
      await createLocationFn({ data: { warehouseCode, name } });
      await refresh();
    },
    [refresh],
  );

  // Clear outstanding timers if the provider goes away mid-edit.
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const operations = useMemo(() => {
    const rows = query.data?.operations ?? [];
    if (pending.current.size === 0) return rows;
    return rows.map((operation) => {
      const patch = pending.current.get(operation.id);
      return patch ? { ...operation, ...patch } : operation;
    });
    // `revision` is what tells us the pending map changed.
  }, [query.data, revision]);

  const value = useMemo<Store>(
    () => ({
      products: query.data?.products ?? [],
      operations,
      moves: query.data?.moves ?? [],
      categories: query.data?.categories ?? [],
      locations: query.data?.locations ?? [],
      warehouses: query.data?.warehouses ?? [],
      locationRows: query.data?.locationRows ?? [],
      quants: query.data?.quants ?? [],
      isLoading: query.isPending,
      role,
      updateOperation,
      createReceipt,
      validateReceipt,
      applyAdjustment,
      createProduct,
      createCategory,
      saveReorderingRule,
      createWarehouse,
      createLocation,
    }),
    [
      query.data,
      query.isPending,
      operations,
      role,
      updateOperation,
      createReceipt,
      validateReceipt,
      applyAdjustment,
      createProduct,
      createCategory,
      saveReorderingRule,
      createWarehouse,
      createLocation,
    ],
  );

  return <StockContext.Provider value={value}>{children}</StockContext.Provider>;
}

export const useStock = () => {
  const context = useContext(StockContext);
  if (!context) throw new Error('StockProvider missing');
  return context;
};
