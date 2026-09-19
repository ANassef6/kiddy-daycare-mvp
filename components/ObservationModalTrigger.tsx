"use client";

import { useState } from "react";
import ObservationModal from "@/components/ObservationModal";

type Props = {
  children: any[];
  areas: any[];
  byName: string;
  defaultChildId?: string;
  defaultAgeGroup?: string;
  trigger?: React.ReactNode;
};

export default function ObservationModalTrigger({
  children,
  areas,
  byName,
  defaultChildId,
  defaultAgeGroup,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)} style={{ cursor: "pointer", display: "inline-block" }}>
        {trigger ?? <button type="button" className="btn btn-primary small">New observation</button>}
      </span>
      <ObservationModal
        children={children}
        areas={areas}
        byName={byName}
        defaultChildId={defaultChildId}
        defaultAgeGroup={defaultAgeGroup}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}