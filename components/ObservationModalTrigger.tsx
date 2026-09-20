"use client";

import { useState } from "react";
import ObservationModal from "@/components/ObservationModal";
import type { Locale, Dict } from "@/lib/i18n";
import { tr } from "@/lib/i18n";

type Props = {
  children: any[];
  areas: any[];
  byName: string;
  defaultChildId?: string;
  defaultAgeGroup?: string;
  trigger?: React.ReactNode;
  locale: Locale;
  dict: Dict;
};

export default function ObservationModalTrigger({
  children,
  areas,
  byName,
  defaultChildId,
  defaultAgeGroup,
  trigger,
  locale,
  dict,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)} style={{ cursor: "pointer", display: "inline-block" }}>
        {trigger ?? <button type="button" className="btn btn-primary small">{tr(dict, "learning.newObservation")}</button>}
      </span>
      <ObservationModal
        children={children}
        areas={areas}
        byName={byName}
        defaultChildId={defaultChildId}
        defaultAgeGroup={defaultAgeGroup}
        open={open}
        onClose={() => setOpen(false)}
        locale={locale}
        dict={dict}
      />
    </>
  );
}