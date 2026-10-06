"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Globe, Plus, Pencil, ShieldCheck, Building2, Users, Clock, CheckCircle2,
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
import { shortDate } from "@/lib/format";
import { toast } from "sonner";

interface Org {
  id: string; name: string; shortName: string | null;
  address: string | null; phone: string | null; email: string | null; logo: string | null;
  currency: string; defaultLocale: "bn" | "en";
  plan: "TRIAL" | "ACTIVE" | "EXPIRED"; trialEndsAt: string | null;
  createdAt: string; isOwner: boolean;
}

const PLAN_BADGE: Record<Org["plan"], string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
  TRIAL: "bg-amber-100 text-amber-700 hover:bg-amber-100",
  EXPIRED: "bg-rose-100 text-rose-700 hover:bg-rose-100",
};

export function PlatformView({
  onChanged, onSwitchOrg,
}: {
  onChanged: () => void;
  onSwitchOrg: (id: string) => void;
}) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  // dialogs
  const [addOpen, setAddOpen] = useState(false);
  const [editOrg, setEditOrg] = useState<Org | null>(null);
  const [busy, setBusy] = useState(false);

  // form fields
  const [fName, setFName] = useState("");
  const [fShort, setFShort] = useState("");
  const [fPlan, setFPlan] = useState<Org["plan"]>("TRIAL");
  const [fAddress, setFAddress] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fCurrency, setFCurrency] = useState("BDT");
  const [fLocale, setFLocale] = useState<"bn" | "en">("bn");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/organizations");
      const d = await r.json();
      setOrgs(d.organizations ?? []);
      const a = await fetch("/api/organization").then((x) => x.json());
      setActiveId(a.organization?.id ?? null);
    } catch { toast.error("Failed to load organizations"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function openAdd() {
    setFName(""); setFShort(""); setFPlan("TRIAL");
    setFCurrency("BDT"); setFLocale("bn");
    setAddOpen(true);
  }
  function openEdit(o: Org) {
    setEditOrg(o);
    setFName(o.name); setFShort(o.shortName ?? ""); setFPlan(o.plan);
    setFAddress(o.address ?? ""); setFPhone(o.phone ?? ""); setFEmail(o.email ?? "");
    setFCurrency(o.currency); setFLocale(o.defaultLocale);
  }

  async function submitAdd() {
    if (!fName.trim()) { toast.error("Name is required"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/organizations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fName, shortName: fShort, plan: fPlan, currency: fCurrency, defaultLocale: fLocale }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(`Onboarded ${fName} (trial)`);
        setAddOpen(false);
        refresh(); onChanged();
      } else toast.error(d.error ?? "Failed");
    } finally { setBusy(false); }
  }

  async function submitEdit() {
    if (!editOrg) return;
    if (!fName.trim()) { toast.error("Name is required"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/organization/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editOrg.id, name: fName, shortName: fShort, address: fAddress,
          phone: fPhone, email: fEmail, currency: fCurrency, defaultLocale: fLocale, plan: fPlan,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success("Organization updated");
        setEditOrg(null);
        refresh(); onChanged();
      } else toast.error(d.error ?? "Failed");
    } finally { setBusy(false); }
  }

  const stats = {
    total: orgs.length,
    active: orgs.filter((o) => o.plan === "ACTIVE").length,
    trial: orgs.filter((o) => o.plan === "TRIAL").length,
    expired: orgs.filter((o) => o.plan === "EXPIRED").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Globe className="size-6 text-blue-600" />
            Platform
          </h1>
          <p className="text-sm text-muted-foreground">SaaS admin — onboard clients, manage plans &amp; per-org branding. Row-level isolation per organization.</p>
        </div>
        <Button onClick={openAdd}><Plus className="size-4" /> Onboard Organization</Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Building2} label="Organizations" value={String(stats.total)} accent="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300" />
        <Stat icon={CheckCircle2} label="Active" value={String(stats.active)} accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300" />
        <Stat icon={Clock} label="On Trial" value={String(stats.trial)} accent="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300" />
        <Stat icon={Users} label="Owner org users" value="2" accent="bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300" />
      </div>

      {/* Organizations table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Organizations</CardTitle>
          <CardDescription>Each client is fully isolated — their data never leaks to another org</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4"><Skeleton className="h-48 rounded" /></div>
          ) : (
            <ScrollArea className="max-h-[28rem]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Trial ends</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Active?</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgs.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="size-8 rounded-lg grid place-items-center font-semibold text-sm bg-muted">
                            {o.name.slice(0, 1)}
                          </div>
                          <div>
                            <div className="font-medium text-sm flex items-center gap-1.5">
                              {o.name}
                              {o.isOwner && <ShieldCheck className="size-3.5 text-emerald-500" title="Owner org" />}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {o.shortName ?? "—"} · {o.currency} · {o.defaultLocale === "bn" ? "বাংলা" : "English"}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><Badge className={PLAN_BADGE[o.plan]}>{o.plan}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{o.trialEndsAt ? shortDate(o.trialEndsAt) : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{shortDate(o.createdAt)}</TableCell>
                      <TableCell>
                        {activeId === o.id
                          ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Active now</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {activeId !== o.id && (
                          <Button size="sm" variant="ghost" onClick={() => onSwitchOrg(o.id)} title="Switch to this org">
                            Switch
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openEdit(o)} title="Edit"><Pencil className="size-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Add org dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="size-4" /> Onboard Organization</DialogTitle>
            <DialogDescription>Create a new client organization on the platform.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Organization name</Label>
              <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Sunrise Properties" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Short name</Label>
                <Input value={fShort} onChange={(e) => setFShort(e.target.value)} placeholder="optional" />
              </div>
              <div>
                <Label className="text-xs">Plan</Label>
                <Select value={fPlan} onValueChange={(v) => setFPlan(v as Org["plan"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRIAL">Trial (14 days)</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="EXPIRED">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Currency</Label>
                <Input value={fCurrency} onChange={(e) => setFCurrency(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Default language</Label>
                <Select value={fLocale} onValueChange={(v) => setFLocale(v as "bn" | "en")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bn">বাংলা (Bangla)</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={submitAdd} disabled={busy}>{busy ? "Onboarding…" : "Onboard"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit org dialog */}
      <Dialog open={!!editOrg} onOpenChange={(o) => !o && setEditOrg(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="size-4" /> Edit Organization</DialogTitle>
            <DialogDescription>{editOrg?.name}{editOrg?.isOwner ? " (owner org — owns the migrated data)" : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Name</Label><Input value={fName} onChange={(e) => setFName(e.target.value)} /></div>
              <div><Label className="text-xs">Short name</Label><Input value={fShort} onChange={(e) => setFShort(e.target.value)} /></div>
            </div>
            <div><Label className="text-xs">Address</Label><Input value={fAddress} onChange={(e) => setFAddress(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Phone</Label><Input value={fPhone} onChange={(e) => setFPhone(e.target.value)} /></div>
              <div><Label className="text-xs">Email</Label><Input value={fEmail} onChange={(e) => setFEmail(e.target.value)} /></div>
            </div>
            <Separator />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Plan</Label>
                <Select value={fPlan} onValueChange={(v) => setFPlan(v as Org["plan"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRIAL">Trial</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="EXPIRED">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Currency</Label><Input value={fCurrency} onChange={(e) => setFCurrency(e.target.value)} /></div>
              <div>
                <Label className="text-xs">Language</Label>
                <Select value={fLocale} onValueChange={(v) => setFLocale(v as "bn" | "en")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bn">বাংলা</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOrg(null)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={busy}>{busy ? "Saving…" : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: string }) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`size-10 rounded-lg grid place-items-center ${accent}`}><Icon className="size-5" /></div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
