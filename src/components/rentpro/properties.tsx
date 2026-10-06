"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Building2, Plus, Pencil, Home, Trash2, Layers, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { money } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";
import { toast } from "sonner";

type PropertyType = "BUILDING" | "OPEN_SPACE" | "ROOFTOP" | "MIXED";
type UnitType = "SHOP" | "ROOM" | "OPEN_SPACE" | "ROOFTOP_SLOT" | "PARKING" | "GODOWN" | "OTHER";

interface PropertySummary {
  id: number; name: string; type: PropertyType;
  unitCount: number; occupied: number; vacant: number; inactive: number;
}
interface UnitDetail {
  id: number; name: string; type: UnitType; defaultRent: number; notes: string | null;
  status: "OCCUPIED" | "VACANT" | "INACTIVE";
  lease: { leaseId: number; tenantName: string; rent: number } | null;
}
interface PropertyDetail {
  property: { id: number; name: string; type: PropertyType };
  units: UnitDetail[];
  occupied: number; vacant: number; inactive: number;
}

const PROP_LABEL: Record<PropertyType, string> = {
  BUILDING: "Building", OPEN_SPACE: "Open Space", ROOFTOP: "Rooftop", MIXED: "Mixed",
};
const UNIT_LABEL: Record<UnitType, string> = {
  SHOP: "Shop", ROOM: "Room", OPEN_SPACE: "Open Space", ROOFTOP_SLOT: "Rooftop Slot",
  PARKING: "Parking", GODOWN: "Godown", OTHER: "Other",
};

function StatusBadge({ status }: { status: UnitDetail["status"] }) {
  if (status === "OCCUPIED")
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Occupied</Badge>;
  if (status === "INACTIVE")
    return <Badge variant="secondary" className="text-muted-foreground">Inactive</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Vacant</Badge>;
}

export function PropertiesView() {
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [propTypes, setPropTypes] = useState<PropertyType[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // dialogs
  const [addPropOpen, setAddPropOpen] = useState(false);
  const [editPropOpen, setEditPropOpen] = useState(false);
  const [editProp, setEditProp] = useState<PropertySummary | null>(null);
  const [addUnitOpen, setAddUnitOpen] = useState(false);
  const [editUnitOpen, setEditUnitOpen] = useState(false);
  const [editU, setEditU] = useState<UnitDetail | null>(null);

  // form fields
  const [pName, setPName] = useState("");
  const [pType, setPType] = useState<PropertyType>("BUILDING");
  const [uName, setUName] = useState("");
  const [uType, setUType] = useState<UnitType>("ROOM");
  const [uRent, setURent] = useState(0);
  const [uNotes, setUNotes] = useState("");
  const [uInactive, setUInactive] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await fetch("/api/properties");
      const d = await r.json();
      setProperties(d.properties ?? []);
    } catch {
      toast.error("Failed to load properties");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (selectedId === null) { setDetail(null); return; }
    setLoadingDetail(true);
    try {
      const r = await fetch(`/api/property?id=${selectedId}`);
      const d = await r.json();
      setDetail(d);
    } catch {
      toast.error("Failed to load property");
    } finally {
      setLoadingDetail(false);
    }
  }, [selectedId]);

  useEffect(() => { refreshList(); }, [refreshList]);
  useEffect(() => { refreshDetail(); }, [refreshDetail]);
  const unitsPaged = usePagination(detail?.units ?? [], 10);
  useEffect(() => {
    fetch("/api/types").then((r) => r.json()).then((d) => {
      setPropTypes(d.propertyTypes ?? []);
      setUnitTypes(d.unitTypes ?? []);
    }).catch(() => {});
  }, []);

  // --- property actions ---
  async function submitAddProp() {
    if (!pName.trim()) { toast.error("Name is required"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/properties", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pName, type: pType }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(`Added ${PROP_LABEL[pType]}: ${pName}`);
        setAddPropOpen(false); setPName(""); setPType("BUILDING");
        refreshList();
      } else toast.error(d.error ?? "Failed");
    } finally { setBusy(false); }
  }

  async function submitEditProp() {
    if (!editProp) return;
    if (!pName.trim()) { toast.error("Name is required"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/property/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editProp.id, name: pName, type: pType }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success("Property updated");
        setEditPropOpen(false);
        refreshList(); refreshDetail();
      } else toast.error(d.error ?? "Failed");
    } finally { setBusy(false); }
  }

  // --- unit actions ---
  async function submitAddUnit() {
    if (!selectedId) return;
    if (!uName.trim()) { toast.error("Unit name is required"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/unit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedId, name: uName, type: uType, defaultRent: uRent, notes: uNotes }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(`Added ${UNIT_LABEL[uType]}: ${uName}`);
        setAddUnitOpen(false);
        setUName(""); setUType("ROOM"); setURent(0); setUNotes("");
        refreshList(); refreshDetail();
      } else toast.error(d.error ?? "Failed");
    } finally { setBusy(false); }
  }

  async function submitEditUnit() {
    if (!editU) return;
    if (!uName.trim()) { toast.error("Unit name is required"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/unit/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editU.id, name: uName, type: uType, defaultRent: uRent,
          notes: uNotes, status: uInactive ? "INACTIVE" : "VACANT",
        }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success("Unit updated");
        setEditUnitOpen(false);
        refreshList(); refreshDetail();
      } else toast.error(d.error ?? "Failed");
    } finally { setBusy(false); }
  }

  async function submitDeleteUnit(u: UnitDetail) {
    if (!confirm(`Delete "${u.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/unit/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success("Unit deleted");
        refreshList(); refreshDetail();
      } else toast.error(d.error ?? "Failed");
    } finally { setBusy(false); }
  }

  function openAddProp() { setPName(""); setPType("BUILDING"); setAddPropOpen(true); }
  function openEditProp(p: PropertySummary) { setEditProp(p); setPName(p.name); setPType(p.type); setEditPropOpen(true); }
  function openAddUnit() { setUName(""); setUType("ROOM"); setURent(0); setUNotes(""); setUInactive(false); setAddUnitOpen(true); }
  function openEditUnit(u: UnitDetail) {
    setEditU(u); setUName(u.name); setUType(u.type); setURent(u.defaultRent);
    setUNotes(u.notes ?? ""); setUInactive(u.status === "INACTIVE"); setEditUnitOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="size-6 text-blue-600" />
            Properties
          </h1>
          <p className="text-sm text-muted-foreground">
            Buildings, open spaces &amp; rooftops — add rooms anytime, even after a property exists.
          </p>
        </div>
        <Button onClick={openAddProp}><Plus className="size-4" /> Add Property</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Property list */}
        <Card className="lg:col-span-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">All Properties</CardTitle>
            <CardDescription>{properties.length} properties</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[32rem]">
              <div className="divide-y">
                {loadingList ? (
                  [0, 1, 2].map((i) => <div key={i} className="p-3"><Skeleton className="h-16 rounded" /></div>)
                ) : properties.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground text-center">No properties.</div>
                ) : properties.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${selectedId === p.id ? "bg-accent" : "hover:bg-muted/50"}`}
                  >
                    <div className={`size-9 rounded-lg grid place-items-center shrink-0 ${
                      p.type === "OPEN_SPACE" ? "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-300"
                      : p.type === "ROOFTOP" ? "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300"
                      : p.type === "MIXED" ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                      : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"
                    }`}>
                      <Building2 className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {PROP_LABEL[p.type]} · {p.unitCount} unit{p.unitCount !== 1 ? "s" : ""}
                      </div>
                      <div className="flex gap-2 mt-1 text-[10px]">
                        <span className="text-emerald-600 dark:text-emerald-400">{p.occupied} occ</span>
                        <span className="text-amber-600 dark:text-amber-400">{p.vacant} vacant</span>
                        {p.inactive > 0 && <span className="text-muted-foreground">{p.inactive} off</span>}
                      </div>
                    </div>
                    {selectedId === p.id && <ArrowRight className="size-4 text-muted-foreground shrink-0 mt-2" />}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Property detail */}
        <Card className="lg:col-span-8">
          <CardContent className="p-0">
            {!selectedId ? (
              <div className="h-[34rem] grid place-items-center text-center">
                <div>
                  <Building2 className="size-10 text-muted-foreground/40 mx-auto mb-2" />
                  <div className="text-sm text-muted-foreground">Pick a property to manage its units.</div>
                </div>
              </div>
            ) : loadingDetail || !detail ? (
              <div className="p-6 space-y-3"><Skeleton className="h-16 rounded" /><Skeleton className="h-64 rounded" /></div>
            ) : (
              <div>
                {/* detail header */}
                <div className="p-4 border-b flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-lg">{detail.property.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {PROP_LABEL[detail.property.type]} · {detail.units.length} units ·{" "}
                      <span className="text-emerald-600 dark:text-emerald-400">{detail.occupied} occupied</span>{" · "}
                      <span className="text-amber-600 dark:text-amber-400">{detail.vacant} vacant</span>
                      {detail.inactive > 0 && <> · {detail.inactive} inactive</>}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openEditProp({ id: detail.property.id, name: detail.property.name, type: detail.property.type, unitCount: detail.units.length, occupied: detail.occupied, vacant: detail.vacant, inactive: detail.inactive })}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button size="sm" onClick={openAddUnit}><Plus className="size-3.5" /> Add Unit</Button>
                </div>

                {/* units table */}
                {detail.units.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <Home className="size-8 text-muted-foreground/40 mx-auto mb-2" />
                    No units yet. <Button variant="link" className="p-0 h-auto" onClick={openAddUnit}>Add the first unit</Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <ScrollArea className="max-h-[26rem]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Unit</TableHead>
                            <TableHead>Type</TableHead>
                          <TableHead className="text-right">Rent</TableHead>
                          <TableHead>Occupant</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unitsPaged.pageItems.map((u) => (
                          <TableRow key={u.id} className={u.status === "INACTIVE" ? "opacity-50" : ""}>
                            <TableCell>
                              <div className="font-medium text-sm">{u.name}</div>
                              {u.notes && <div className="text-xs text-muted-foreground truncate max-w-[16rem]">{u.notes}</div>}
                            </TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px]">{UNIT_LABEL[u.type]}</Badge></TableCell>
                            <TableCell className="text-right tabular-nums">{money(u.defaultRent)}</TableCell>
                            <TableCell className="text-sm">{u.lease ? u.lease.tenantName : <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="text-center"><StatusBadge status={u.status} /></TableCell>
                            <TableCell className="text-right">
                              <Button size="icon" variant="ghost" className="size-8" onClick={() => openEditUnit(u)} title="Edit"><Pencil className="size-3.5" /></Button>
                              <Button size="icon" variant="ghost" className="size-8" onClick={() => submitDeleteUnit(u)} title="Delete"><Trash2 className="size-3.5" /></Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                  <Pager page={unitsPaged.page} totalPages={unitsPaged.totalPages} total={unitsPaged.total} pageSize={unitsPaged.pageSize} onPrev={unitsPaged.prev} onNext={unitsPaged.next} />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit Property dialog */}
      <Dialog open={addPropOpen || editPropOpen} onOpenChange={(o) => { if (!o) { setAddPropOpen(false); setEditPropOpen(false); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Layers className="size-4" /> {addPropOpen ? "Add Property" : "Edit Property"}</DialogTitle>
            <DialogDescription>Create a building, open space, rooftop, or mixed property.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="e.g. মহিপাল মার্কেট / Rooftop — 2 no" />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={pType} onValueChange={(v) => setPType(v as PropertyType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {propTypes.map((t) => <SelectItem key={t} value={t}>{PROP_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddPropOpen(false); setEditPropOpen(false); }}>Cancel</Button>
            <Button onClick={addPropOpen ? submitAddProp : submitEditProp} disabled={busy}>
              {busy ? "Saving…" : addPropOpen ? "Add Property" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Unit dialog */}
      <Dialog open={addUnitOpen || editUnitOpen} onOpenChange={(o) => { if (!o) { setAddUnitOpen(false); setEditUnitOpen(false); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Home className="size-4" /> {addUnitOpen ? "Add Unit" : "Edit Unit"}</DialogTitle>
            <DialogDescription>
              {addUnitOpen ? `Add a room/shop/space to ${detail?.property.name ?? ""}.` : `Editing ${editU?.name ?? ""}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Unit name</Label>
              <Input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="e.g. L-3 S-1 ( ৩য় তলায় ১ম দোকান )" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={uType} onValueChange={(v) => setUType(v as UnitType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {unitTypes.map((t) => <SelectItem key={t} value={t}>{UNIT_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Default rent (৳)</Label>
                <Input type="number" value={uRent} onChange={(e) => setURent(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input value={uNotes} onChange={(e) => setUNotes(e.target.value)} placeholder="optional" />
            </div>
            {editUnitOpen && (
              <label className="flex items-center gap-2 text-sm rounded-md border p-3 cursor-pointer">
                <input type="checkbox" checked={uInactive} onChange={(e) => setUInactive(e.target.checked)} className="size-4" />
                <span>Retire this unit (set Inactive — hidden from occupancy)</span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddUnitOpen(false); setEditUnitOpen(false); }}>Cancel</Button>
            <Button onClick={addUnitOpen ? submitAddUnit : submitEditUnit} disabled={busy}>
              {busy ? "Saving…" : addUnitOpen ? "Add Unit" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
