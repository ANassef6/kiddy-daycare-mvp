"use client";

import { useMemo, useState } from "react";
import { createObservationAction } from "@/lib/actions";
import type { Locale, Dict } from "@/lib/i18n";
import { tr } from "@/lib/i18n";

type Milestone = { id: string; name: string; description?: string; age_group?: string; learning_point_name?: string };
type LearningPoint = { id: string; name: string; age_group?: string; milestones?: Milestone[] };
type Area = { id: string; name: string; learning_points?: LearningPoint[] };
type Child = { id: string; first_name: string; last_name: string; dob?: string };

const PROGRESS_LEVELS = ["Emerging", "Developing", "Secure"] as const;

// KID-53 #4, KID-55 #7/#8/#9, KID-57: observation modal — By/To row,
// observation + next-steps columns, file attach input, Post, and the
// "Add curriculum goals" picker (areas left, age bands, single goal radio +
// progress level, Cancel/Add selected). Fully localized (en/ar).
export default function ObservationModal({
  children,
  areas,
  byName,
  defaultChildId,
  defaultAgeGroup,
  open,
  onClose,
  locale,
  dict,
}: {
  children: Child[];
  areas: Area[];
  byName: string;
  defaultChildId?: string;
  defaultAgeGroup?: string;
  open: boolean;
  onClose: () => void;
  locale: Locale;
  dict: Dict;
}) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const [childId, setChildId] = useState(defaultChildId ?? children[0]?.id ?? "");
  const [ageGroup, setAgeGroup] = useState(defaultAgeGroup ?? "");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [observation, setObservation] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [showGoals, setShowGoals] = useState(false);
  // KID-55 #7: single curriculum goal only (radio, not multi-checkbox).
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  // KID-55 #8: child's progress level for the chosen goal + age band.
  const [progress, setProgress] = useState<string>("");

  const activeArea = areas.find((a) => a.id === areaId);

  const goalsInView = useMemo(() => {
    const out: Milestone[] = [];
    for (const lp of activeArea?.learning_points ?? []) {
      for (const m of lp.milestones ?? []) {
        if (ageGroup && m.age_group && m.age_group !== ageGroup) continue;
        out.push({ ...m, learning_point_name: lp.name });
      }
    }
    return out;
  }, [activeArea, ageGroup]);

  const toggleGoal = (id: string) => setSelectedGoal((prev) => (prev === id ? null : id));

  const ageGroups = Array.from(
    new Set(areas.flatMap((a) => (a.learning_points ?? []).map((lp) => lp.age_group).filter(Boolean))) as Set<string>
  );

  if (!open) return null;

  const chosenGoalRows = goalsInView.filter((m) => m.id === selectedGoal);
  const chosenGoal = chosenGoalRows[0];
  const progressLabel = progress ? tr(dict, `learning.${progress.toLowerCase()}`) : "";
  const body = [observation.trim(), progress && chosenGoal ? `${t("learning.progress")}: ${progress}` : "", nextSteps.trim() ? `${t("learning.nextSteps")}: ${nextSteps.trim()}` : ""]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,23,0.55)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 16px",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "100%", maxWidth: 680, maxHeight: "90vh", overflowY: "auto", background: "var(--color-surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>{t("learning.newObservation")}</h3>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 20, color: "var(--color-muted)" }} aria-label={t("common.close")}>
            ×
          </button>
        </div>

        <form action={createObservationAction}>
          <div className="row" style={{ alignItems: "center" }}>
            <div className="col field" style={{ minWidth: 0 }}>
              <label className="label">{t("learning.by")}</label>
              <input className="input" value={byName} readOnly disabled style={{ background: "color-mix(in srgb, var(--color-surface) 60%, #e2e8f0)" }} />
            </div>
            <div className="col field">
              <label className="label">{t("learning.to")}</label>
              <select className="select" name="childId" value={childId} onChange={(e) => setChildId(e.target.value)} required>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="row">
            <div className="col field">
              <label className="label">{t("learning.observation")}</label>
              <textarea className="textarea" name="observation" value={observation} onChange={(e) => setObservation(e.target.value)} required placeholder={t("learning.whatDidYouObserve")} style={{ minHeight: 96 }} />
            </div>
            <div className="col field">
              <label className="label">{t("learning.nextSteps")}</label>
              <textarea
                className="textarea"
                value={nextSteps}
                onChange={(e) => setNextSteps(e.target.value)}
                placeholder={t("learning.whatComesNext")}
                style={{ minHeight: 96 }}
              />
            </div>
          </div>

          <div className="field">
            <label className="label">{t("learning.kind")}</label>
            <select className="select" name="kind" defaultValue="observation" style={{ maxWidth: 200 }}>
              <option value="observation">{t("learning.observation")}</option>
              <option value="milestone">{t("learning.milestone")}</option>
              <option value="goal">{t("learning.goal")}</option>
              <option value="assessment">{t("learning.assessment")}</option>
            </select>
          </div>

          <input type="hidden" name="body" value={body} />
          <input type="hidden" name="ageGroup" value={ageGroup} />
          <input type="hidden" name="title" value={nextSteps.trim() ? `${t("learning.nextSteps")}: ${nextSteps.trim()}` : ""} />
          <input type="hidden" name="progress" value={progress} />
          {selectedGoal && <input type="hidden" name="goalIds" value={selectedGoal} />}
          {selectedGoal && <input type="hidden" name="learningPointId" value="" />}

          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <label className="small muted" style={{ display: "inline-flex", gap: 6, cursor: "pointer" }} title={t("learning.attachMedia")}>
                <span aria-hidden="true">📷 🎞 📎</span> {t("learning.attach")}
                <input type="file" name="attachments" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} />
              </label>
              {selectedGoal && (
                <button type="button" className="badge badge-green" style={{ cursor: "default" }}>
                  {t("learning.curriculumGoalAttached")}{progress ? ` · ${progressLabel}` : ""}
                </button>
              )}
              <button type="button" onClick={() => setShowGoals((s) => !s)} className="btn btn-ghost small">
                {showGoals ? t("learning.hideCurriculumGoals") : t("learning.addCurriculumGoals")}
              </button>
            </div>
            <button className="btn btn-primary" type="submit">{t("learning.post")}</button>
          </div>
        </form>

        {showGoals && (
          <div className="card mt-3" style={{ borderColor: "var(--color-border)", background: "color-mix(in srgb, var(--color-surface) 85%, #eef2ff)" }}>
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <h4 className="subtitle" style={{ margin: 0 }}>{t("learning.addCurriculumGoals")}</h4>
              <div className="row" style={{ gap: 6 }}>
                {ageGroup === "" && <span className="badge badge-gray">{t("learning.allAgeBands")}</span>}
                {ageGroups.map((g) => (
                  <button key={g} type="button" onClick={() => setAgeGroup((prev) => (prev === g ? "" : g))} className={ageGroup === g ? "badge badge-red" : "badge badge-gray"} style={{ cursor: "pointer", border: "none", fontSize: 12 }}>
                    {String(g)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 14, marginTop: 12 }}>
              <div style={{ borderInlineEnd: "1px solid var(--color-border)", paddingInlineEnd: 10 }}>
                {areas.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAreaId(a.id)}
                    className="small"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "start",
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      background: a.id === areaId ? "color-mix(in srgb, var(--brand-primary) 12%, transparent)" : "transparent",
                      fontWeight: a.id === areaId ? 700 : 500,
                      color: "var(--color-text)",
                      marginBottom: 2,
                    }}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {goalsInView.length === 0 && <p className="muted small">{t("learning.noGoalsMatch")}</p>}
                {goalsInView.map((m) => (
                  <label key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", cursor: "pointer", fontSize: 13 }}>
                    <input
                      type="radio"
                      name="goalChoice"
                      checked={selectedGoal === m.id}
                      onChange={() => toggleGoal(m.id)}
                      style={{ accentColor: "var(--brand-primary)", marginTop: 2 }}
                    />
                    <span>
                      <strong>{m.name}</strong>
                      {m.learning_point_name && <span className="muted"> · {m.learning_point_name}</span>}
                      {m.description && <div className="muted small">{m.description}</div>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {selectedGoal && ageGroup && (
              <div className="mt-3">
                <div className="label">{t("learning.ageBandPrompt", { band: ageGroup, name: children.find((c) => c.id === childId)?.first_name ?? t("learning.theChild") })}</div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {PROGRESS_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setProgress((p) => (p === level ? "" : level))}
                      className={progress === level ? "badge badge-red" : "badge badge-gray"}
                      style={{ cursor: "pointer", border: "none", fontSize: 12 }}
                    >
                      <span style={{ marginInlineEnd: 4 }}>{level === "Emerging" ? "🟡" : level === "Developing" ? "🟢" : "🔵"}</span>
                      {t(`learning.${level.toLowerCase()}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="row mt-3" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost small" onClick={() => { setSelectedGoal(null); setProgress(""); }}>{t("learning.cancel")}</button>
              <button type="button" className="btn btn-primary small" onClick={() => setShowGoals(false)}>{t("learning.addSelected", { count: selectedGoal ? 1 : 0 })}</button>
            </div>
          </div>
        )}
        {chosenGoalRows.map((m) => (
          <input key={`chk-${m.id}`} type="hidden" name="goalIds" value={m.id} />
        ))}
      </div>
    </div>
  );
}