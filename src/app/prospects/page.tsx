"use client";
import { ResearchPanel } from "@/components/research";
import { Card, CardBody, PageHeader } from "@/components/ui";

export default function Prospects() {
  return (
    <>
      <PageHeader
        title="Add companies"
        description="Type or paste company domains. Each becomes a chip; invalid ones are struck through (hover for the reason) and duplicates are dropped. Tip: press N anywhere to open this as a pop-up."
      />
      <Card>
        <CardBody>
          <ResearchPanel onFinished={() => window.dispatchEvent(new Event("pipeline:changed"))} />
        </CardBody>
      </Card>
    </>
  );
}
