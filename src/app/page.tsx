"use client";
import { CheckCircle2, CircleAlert, Inbox, MailCheck, PlusCircle, Timer, Users, UserCheck } from "lucide-react";
import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { fmtDuration, useApi } from "@/lib/client";

interface Stats {
  total: number;
  qualified: number;
  contactsVerified: number;
  draftsReady: number;
  sent: number;
  avgProcessingMs: number | null;
  finishedRuns: number;
  byStatus: Record<string, number>;
}
interface Health {
  env: Record<string, boolean>;
  database: "ok" | "error" | "not_configured";
}

export default function Overview() {
  const stats = useApi<Stats>("/api/stats", 15000);
  const health = useApi<Health>("/api/health");

  const tiles = stats.data
    ? [
        { label: "Companies processed", value: stats.data.total, icon: Users },
        { label: "Qualified leads", value: stats.data.qualified, icon: CheckCircle2 },
        { label: "Contacts verified", value: stats.data.contactsVerified, icon: UserCheck },
        { label: "Drafts ready", value: stats.data.draftsReady, icon: Inbox },
        { label: "Test emails sent", value: stats.data.sent, icon: MailCheck },
        {
          label: "Avg processing time",
          value: fmtDuration(stats.data.avgProcessingMs),
          icon: Timer,
          note: stats.data.finishedRuns ? `${stats.data.finishedRuns} finished run(s). Faculty target: under 2 min.` : "No finished runs yet",
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live numbers from your database. Nothing here is simulated — an empty system shows zeros."
        action={
          <Link href="/prospects" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg hover:opacity-90">
            <PlusCircle className="h-4 w-4" /> Add prospects
          </Link>
        }
      />

      {stats.error && (
        <div className="mb-6">
          <ErrorNote>Could not load stats: {stats.error}. Check the system status below.</ErrorNote>
        </div>
      )}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stats.loading
          ? Array.from({ length: 6 }, (_, i) => (
              <Card key={i}>
                <CardBody className="space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                </CardBody>
              </Card>
            ))
          : tiles.map((t) => (
              <Card key={t.label}>
                <CardBody>
                  <div className="flex items-center justify-between text-muted">
                    <span className="text-sm">{t.label}</span>
                    <t.icon className="h-4 w-4" />
                  </div>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{t.value}</p>
                  {"note" in t && t.note && <p className="mt-1 text-xs text-muted">{t.note}</p>}
                </CardBody>
              </Card>
            ))}
      </section>

      {stats.data && stats.data.total === 0 && (
        <Card className="mt-6">
          <EmptyState icon={<Inbox className="h-8 w-8" />} title="No companies yet">
            Add one or more company domains to run the seven-stage workflow.{" "}
            <Link href="/prospects" className="font-medium text-primary underline">
              Go to Prospect Input
            </Link>
          </EmptyState>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="System status" subtitle="Which integrations are configured on the server (values are never shown)." />
        <CardBody>
          {health.loading ? (
            <Skeleton className="h-16" />
          ) : health.error ? (
            <ErrorNote>{health.error}</ErrorNote>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {Object.entries(health.data!.env).map(([k, ok]) => (
                  <Badge key={k} tone={ok ? "ok" : "warn"}>
                    {ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />} {k}
                  </Badge>
                ))}
              </div>
              <p className="text-sm text-muted">
                Database:{" "}
                <Badge tone={health.data!.database === "ok" ? "ok" : health.data!.database === "error" ? "bad" : "warn"}>
                  {health.data!.database === "ok" ? "connected" : health.data!.database === "error" ? "connection error" : "not configured"}
                </Badge>
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
