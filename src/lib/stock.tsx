import { createContext, useContext, useState, type ReactNode } from 'react';

export type Status = 'Draft' | 'Waiting' | 'Ready' | 'Done' | 'Canceled';
export type Kind = 'Receipt' | 'Delivery' | 'Internal Transfer' | 'Adjustment';
export type Product = { id: string; name: string; sku: string; category: string; unit: string; onHand: number; minimum: number; maximum: number; location: string };
export type Line = { productId: string; demand: number; received: number };
export type Operation = { id: string; kind: Kind; status: Status; partner: string; date: string; location: string; source: string; lines: Line[] };
export type Move = { id: string; date: string; reference: string; productId: string; from: string; to: string; quantity: number; kind: Kind; status: Status; by: string };
const categories = ['Raw Materials', 'Finished Goods', 'Consumables', 'Packaging'];
export const initialProducts: Product[] = [
 ['Steel Rods','RAW-STEEL-001','Raw Materials','kg',77,30,180,'Main / Stock'],
 ['Aluminum Sheets','RAW-ALU-002','Raw Materials','sheets',12,25,100,'Main / Rack A'],
 ['Copper Wire','RAW-COP-003','Raw Materials','m',8,20,90,'Main / Rack B'],
 ['Assembly Kit A','FIN-KIT-004','Finished Goods','units',32,15,80,'Main / Stock'],
 ['Assembly Kit B','FIN-KIT-005','Finished Goods','units',4,15,70,'East / Stock'],
 ['Industrial Valve','FIN-VAL-006','Finished Goods','units',0,10,55,'East / Stock'],
 ['Lubricant','CON-LUB-007','Consumables','L',3,12,45,'Main / Stock'],
 ['Safety Gloves','CON-GLV-008','Consumables','pairs',9,20,100,'East / Stock'],
 ['Packing Tape','PAC-TAP-009','Packaging','rolls',6,18,70,'Main / Stock'],
 ['Shipping Box M','PAC-BOX-010','Packaging','units',0,30,140,'East / Stock'],
 ['Pallet Wrap','PAC-WRP-011','Packaging','rolls',11,25,90,'Main / Stock'],
 ['Fasteners','RAW-FAS-012','Raw Materials','boxes',34,30,110,'Main / Rack A'],
].map(([name,sku,category,unit,onHand,minimum,maximum,location],i) => ({id:String(i+1),name:String(name),sku:String(sku),category:String(category),unit:String(unit),onHand:Number(onHand),minimum:Number(minimum),maximum:Number(maximum),location:String(location)}));
const receipt = (n:number,status:Status,partner:string,date:string,lines:Line[]):Operation => ({id:`WH/IN/${String(n).padStart(5,'0')}`,kind:'Receipt',status,partner,date,location:'Main / Stock',source:`PO-2026-${110+n}`,lines});
export const initialOperations: Operation[] = [
 receipt(1,'Done','Northline Metals','2026-09-20',[{productId:'1',demand:100,received:100}]),
 receipt(2,'Ready','Atlas Industrial Supply','2026-09-28',[{productId:'1',demand:50,received:50},{productId:'2',demand:30,received:30}]),
 receipt(3,'Waiting','Pacific Materials','2026-09-29',[{productId:'3',demand:25,received:0}]),
 receipt(4,'Draft','Northline Metals','2026-10-01',[{productId:'12',demand:40,received:0}]),
 receipt(5,'Ready','Summit Supply Co.','2026-09-30',[{productId:'9',demand:20,received:20}]),
 receipt(6,'Canceled','Atlas Industrial Supply','2026-09-18',[{productId:'8',demand:10,received:0}]),
 ...['Done','Ready','Waiting','Draft','Done'].map((status,i):Operation=>({id:`WH/OUT/${String(i+1).padStart(5,'0')}`,kind:'Delivery',status:status as Status,partner:['Acme Manufacturing','Westbridge Works','Porter Group','Orion Labs','Cedar Industries'][i] ?? 'Customer',date:`2026-09-${String(21+i).padStart(2,'0')}`,location:'Main / Stock',source:`SO-${120+i}`,lines:[{productId:i===0?'1':String(i+4),demand:i===0?20:5,received:i===0?20:0}]})),
 ...['Done','Ready','Draft'].map((status,i):Operation=>({id:`WH/INT/${String(i+1).padStart(5,'0')}`,kind:'Internal Transfer',status:status as Status,partner:'Production Rack',date:`2026-09-${22+i}`,location:'Main / Stock',source:'',lines:[{productId:i===0?'1':'2',demand:i===0?30:5,received:i===0?30:0}]})),
 ...['Done','Draft'].map((status,i):Operation=>({id:`WH/ADJ/${String(i+1).padStart(5,'0')}`,kind:'Adjustment',status:status as Status,partner:'Cycle count',date:`2026-09-${24+i}`,location:'Main / Stock',source:'',lines:[{productId:i===0?'1':'9',demand:i===0?-3:0,received:i===0?-3:0}]})),
];
const steelMoves:Move[] = [
 {id:'m1',date:'2026-09-20T09:35',reference:'WH/IN/00001',productId:'1',from:'Vendors',to:'Main / Stock',quantity:100,kind:'Receipt',status:'Done',by:'Alex Morgan'},
 {id:'m2',date:'2026-09-22T11:20',reference:'WH/INT/00001',productId:'1',from:'Main / Stock',to:'Production Rack',quantity:0,kind:'Internal Transfer',status:'Done',by:'Alex Morgan'},
 {id:'m3',date:'2026-09-23T14:12',reference:'WH/OUT/00001',productId:'1',from:'Production Rack',to:'Customers',quantity:-20,kind:'Delivery',status:'Done',by:'Jordan Lee'},
 {id:'m4',date:'2026-09-24T16:45',reference:'WH/ADJ/00001',productId:'1',from:'Main / Stock',to:'Inventory Loss',quantity:-3,kind:'Adjustment',status:'Done',by:'Alex Morgan'},
];
export const initialMoves:Move[] = [...steelMoves, ...Array.from({length:22},(_,i):Move=>({id:`m${i+5}`,date:`2026-09-${String(5+i).padStart(2,'0')}T${String(9+i%8).padStart(2,'0')}:15`,reference:(initialOperations[(i+1)%initialOperations.length]?.id ?? 'WH/IN/00001'),productId:String(i%11+2),from:i%3===0?'Vendors':'Main / Stock',to:i%3===0?'Main / Stock':i%3===1?'Customers':'East / Stock',quantity:i%3===0?20:i%3===1?-5:0,kind:(initialOperations[(i+1)%initialOperations.length]?.kind ?? 'Receipt'),status:'Done',by:i%2?'Alex Morgan':'Jordan Lee'}))].sort((a,b)=>b.date.localeCompare(a.date));
type Store = { products:Product[]; operations:Operation[]; moves:Move[]; role:'Inventory Manager'|'Warehouse Staff'; setRole:(role:'Inventory Manager'|'Warehouse Staff')=>void; updateOperation:(id:string,patch:Partial<Operation>)=>void; createReceipt:()=>string; validateReceipt:(id:string)=>void; applyAdjustment:(counts:Record<string,number>,reason:string)=>number };
const StockContext = createContext<Store | null>(null);
export function StockProvider({children}:{children:ReactNode}) {
 const [products,setProducts]=useState(initialProducts); const [operations,setOperations]=useState(initialOperations); const [moves,setMoves]=useState(initialMoves); const [role,setRole]=useState<'Inventory Manager'|'Warehouse Staff'>('Inventory Manager');
 const updateOperation=(id:string,patch:Partial<Operation>)=>setOperations(prev=>prev.map(op=>op.id===id?{...op,...patch}:op));
 const createReceipt=()=>{const id=`WH/IN/${String(Math.max(0,...operations.filter(o=>o.kind==='Receipt').map(o=>Number(o.id.split('/').at(-1))))+1).padStart(5,'0')}`; setOperations(prev=>[{id,kind:'Receipt',status:'Draft',partner:'',date:new Date().toISOString().slice(0,10),location:'Main / Stock',source:'',lines:[]},...prev]); return id};
 const validateReceipt=(id:string)=>{const op=operations.find(o=>o.id===id); if(!op||op.status!=='Ready')return; const lines=op.lines.filter(l=>l.productId&&l.received>0); setProducts(prev=>prev.map(p=>({...p,onHand:p.onHand+lines.filter(l=>l.productId===p.id).reduce((a,l)=>a+l.received,0)}))); setMoves(prev=>[...lines.map((l,i):Move=>({id:`${id}-${i}`,date:new Date().toISOString().slice(0,16),reference:id,productId:l.productId,from:'Vendors',to:op.location,quantity:l.received,kind:'Receipt',status:'Done',by:'Alex Morgan'})),...prev]); updateOperation(id,{status:'Done'});};
 const applyAdjustment=(counts:Record<string,number>,reason:string)=>{const changed=products.filter(p=>counts[p.id]!==undefined&&Number(counts[p.id])!==p.onHand); if(!changed.length)return 0; const id=`WH/ADJ/${String(operations.filter(o=>o.kind==='Adjustment').length+1).padStart(5,'0')}`; const date=new Date().toISOString().slice(0,16); setMoves(prev=>[...changed.map((p,i):Move=>({id:`${id}-${i}`,date,reference:id,productId:p.id,from:Number(counts[p.id])>p.onHand?'Inventory Loss':p.location,to:Number(counts[p.id])>p.onHand?p.location:'Inventory Loss',quantity:Number(counts[p.id])-p.onHand,kind:'Adjustment',status:'Done',by:'Alex Morgan'})),...prev]);setOperations(prev=>[{id,kind:'Adjustment',status:'Done',partner:reason,date:date.slice(0,10),location:'Main / Stock',source:'',lines:changed.map(p=>({productId:p.id,demand:Number(counts[p.id])-p.onHand,received:Number(counts[p.id])-p.onHand}))},...prev]);setProducts(prev=>prev.map(p=>counts[p.id]===undefined?p:{...p,onHand:Number(counts[p.id])}));return changed.length;};
 return <StockContext.Provider value={{products,operations,moves,role,setRole,updateOperation,createReceipt,validateReceipt,applyAdjustment}}>{children}</StockContext.Provider>;
}
export const useStock=()=>{const context=useContext(StockContext);if(!context)throw new Error('StockProvider missing');return context};
export {categories};
