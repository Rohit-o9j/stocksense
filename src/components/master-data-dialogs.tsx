/**
 * Create/edit dialogs for master data.
 *
 * Each one owns its open state and talks to the store, so the page components
 * only need to drop the button in.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useStock, type Product } from '@/lib/stock';

const field = 'mt-1.5 w-full rounded-md border border-input bg-background px-3 h-9 text-sm';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

/** Shared shell: a trigger button, a form dialog, busy state and error display. */
function FormDialog({
  trigger,
  title,
  description,
  submitLabel,
  onSubmit,
  children,
}: {
  trigger: (open: () => void, disabled: boolean) => ReactNode;
  title: string;
  description: string;
  submitLabel: string;
  onSubmit: (values: FormData) => Promise<void>;
  children: ReactNode;
}) {
  const { role } = useStock();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const readOnly = role === 'Warehouse Staff';

  const handle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    setBusy(true);
    setError('');
    try {
      await onSubmit(new FormData(form));
      setOpen(false);
      toast.success(`${title.replace(/^New /, '')} saved`);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {trigger(() => {
        setError('');
        setOpen(true);
      }, readOnly)}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger"
            >
              {error}
            </p>
          )}
          <form onSubmit={handle} className="space-y-4">
            {children}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : submitLabel}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function masterTrigger(label: string) {
  return (open: () => void, disabled: boolean) => (
    <span
      title={disabled ? 'Inventory Manager access required' : undefined}
      className="inline-flex"
    >
      <Button onClick={open} disabled={disabled}>
        <Plus /> {label}
      </Button>
    </span>
  );
}

export function NewProductButton() {
  const { createProduct, categories, locations } = useStock();

  return (
    <FormDialog
      trigger={masterTrigger('New Product')}
      title="New Product"
      description="Opening stock is recorded as a real receipt, so it appears in Move History."
      submitLabel="Create product"
      onSubmit={async (values) => {
        const initial = Number(values.get('initialStock') ?? 0);
        const min = Number(values.get('minQty') ?? 0);
        const max = Number(values.get('maxQty') ?? 0);
        await createProduct({
          name: String(values.get('name') ?? ''),
          sku: String(values.get('sku') ?? ''),
          category: String(values.get('category') ?? ''),
          unit: String(values.get('unit') ?? ''),
          location: String(values.get('location') ?? ''),
          ...(initial > 0 && { initialStock: initial }),
          ...(min > 0 && { minQty: min }),
          ...(max > 0 && { maxQty: max }),
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-xs font-medium text-muted-foreground">
          Product name
          <Input name="name" required placeholder="Steel Rods" className="mt-1.5" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          SKU / Code
          <Input name="sku" required placeholder="RAW-STEEL-013" className="mt-1.5" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Unit of measure
          <Input name="unit" required defaultValue="units" className="mt-1.5" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Category
          <select name="category" required className={field}>
            {categories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Location
          <select name="location" className={field}>
            {locations.map((location) => (
              <option key={location}>{location}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Initial stock (optional)
          <Input name="initialStock" type="number" min="0" placeholder="0" className="mt-1.5" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-muted-foreground">
            Min
            <Input name="minQty" type="number" min="0" placeholder="0" className="mt-1.5" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Max
            <Input name="maxQty" type="number" min="0" placeholder="0" className="mt-1.5" />
          </label>
        </div>
      </div>
    </FormDialog>
  );
}

export function NewCategoryButton() {
  const { createCategory } = useStock();

  return (
    <FormDialog
      trigger={masterTrigger('New Category')}
      title="New Category"
      description="Categories group products for filtering and reporting."
      submitLabel="Create category"
      onSubmit={async (values) => {
        await createCategory(String(values.get('name') ?? ''));
      }}
    >
      <label className="block text-xs font-medium text-muted-foreground">
        Category name
        <Input name="name" required placeholder="Spare Parts" className="mt-1.5" />
      </label>
    </FormDialog>
  );
}

export function NewWarehouseButton() {
  const { createWarehouse } = useStock();

  return (
    <FormDialog
      trigger={masterTrigger('New Warehouse')}
      title="New Warehouse"
      description="A Stock location is created automatically so the warehouse can receive goods."
      submitLabel="Create warehouse"
      onSubmit={async (values) => {
        const address = String(values.get('address') ?? '').trim();
        await createWarehouse({
          name: String(values.get('name') ?? ''),
          code: String(values.get('code') ?? ''),
          ...(address && { address }),
        });
      }}
    >
      <label className="block text-xs font-medium text-muted-foreground">
        Warehouse name
        <Input name="name" required placeholder="South Warehouse" className="mt-1.5" />
      </label>
      <label className="block text-xs font-medium text-muted-foreground">
        Short code
        <Input name="code" required maxLength={8} placeholder="SOUTH" className="mt-1.5" />
      </label>
      <label className="block text-xs font-medium text-muted-foreground">
        Address (optional)
        <Input name="address" placeholder="3 Dockside Lane" className="mt-1.5" />
      </label>
    </FormDialog>
  );
}

export function AddLocationButton({ warehouseCode }: { warehouseCode: string }) {
  const { createLocation } = useStock();

  return (
    <FormDialog
      trigger={(open, disabled) => (
        <span
          title={disabled ? 'Inventory Manager access required' : undefined}
          className="inline-flex"
        >
          <Button variant="outline" size="sm" onClick={open} disabled={disabled}>
            <Plus /> Add location
          </Button>
        </span>
      )}
      title="New Location"
      description="Locations sit inside a warehouse and hold stock."
      submitLabel="Create location"
      onSubmit={async (values) => {
        await createLocation(warehouseCode, String(values.get('name') ?? ''));
      }}
    >
      <label className="block text-xs font-medium text-muted-foreground">
        Location name
        <Input name="name" required placeholder="Rack C" className="mt-1.5" />
      </label>
    </FormDialog>
  );
}

export function EditRuleButton({ product }: { product: Product }) {
  const { saveReorderingRule } = useStock();

  return (
    <FormDialog
      trigger={(open, disabled) => (
        <span title={disabled ? 'Inventory Manager access required' : undefined}>
          <Button size="sm" variant="ghost" onClick={open} disabled={disabled}>
            Edit
          </Button>
        </span>
      )}
      title={`Reordering rule · ${product.name}`}
      description="Low stock alerts fire when on hand drops below the minimum."
      submitLabel="Save rule"
      onSubmit={async (values) => {
        await saveReorderingRule(
          product.id,
          Number(values.get('minQty') ?? 0),
          Number(values.get('maxQty') ?? 0),
        );
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-muted-foreground">
          Minimum ({product.unit})
          <Input
            name="minQty"
            type="number"
            min="0"
            required
            defaultValue={product.minimum}
            className="mt-1.5"
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Maximum ({product.unit})
          <Input
            name="maxQty"
            type="number"
            min="0"
            required
            defaultValue={product.maximum}
            className="mt-1.5"
          />
        </label>
      </div>
    </FormDialog>
  );
}
