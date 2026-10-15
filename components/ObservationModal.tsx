"use client";

import { useMemo, useState } from "react";
import { createObservationAction } from "@/lib/actions";
import type { Locale, Dict } from "@/lib/i18n";
import { tr } from "@/lib/i18n";

type Milestone = { id: string; name: string; description?: string; age_group?: string; learning_point_name?: string };
type LearningPoint = { id: string; name: string; age_group?: string; milestones?: Milestone[] };
type Area = { id: string; name: string; learning_points?: LearningPoint[] };type Child = { id: string; first_name: string; last_name: string; dob?: string };

const PROGRESS_LEVELS = ["Emerging", "Developing", "Secure"] as const;

// KID-53 #4, KID-55 #7/#8/#9, KID-57: observation modal — By/To row,
// observation + next-steps columns, file attach input, Post, and the
// "Add curriculum goals" picker (areas left, age bands, single goal radio +
// progress level, Cancel/Add selected). Fully localized (en/ar).
export default function ObservationModal({
  childChoices,
  areas,
  byName,
  defaultChildId,
  defaultAgeGroup,
  open,
  onClose,
  locale,
  dict,
}: {
  childChoices: Child[];
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
  const [childId, setChildId] = useState(defaultChildId ?? childChoices[0]?.id ?? "");
  const [ageGroup, setAgeGroup] = useState(defaultAgeGroup ?? "");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [observation, setObservation] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [showGoals, setShowGoals] = useState(false);
  // KID-86 #5/#6: single-select sub-goal (a learning point) — choosing one
  // clears the previous highlight, and reveals that sub-goal's milestones so
  // the child can be graded Emerging / Developing / Secure.
  const [selectedSubGoal, setSelectedSubGoal] = useState<string | null>(null);
  // KID-55 #8: child's progress level for the chosen goal + age band.
  const [progress, setProgress] = useState<string>("");

  const activeArea = areas.find((a) => a.id === areaId);

  // Sub-goals of the active area (learning points), optionally narrowed to the
  // selected age band.
  const subGoalsInView = useMemo(() => {
    const lps = activeArea?.learning_points ?? [];
    return ageGroup ? lps.filter((lp) => !lp.age_group || lp.age_group === ageGroup) : lps;
  }, [activeArea, ageGroup]);

  // Milestones that belong to the selected sub-goal, narrowed by age band.
  const subGoalMilestones = useMemo(() => {
    const lp = (activeArea?.learning_points ?? []).find((l) => l.id === selectedSubGoal);
    const list = lp?.milestones ?? [];
    return ageGroup ? list.filter((m) => !m.age_group || m.age_group === ageGroup) : list;
  }, [activeArea, selectedSubGoal, ageGroup]);

  // Single-select: choosing a sub-goal un-highlights the previous one; the same
  // row toggles it off.
  const selectSubGoal = (id: string) => {
    setSelectedSubGoal((prev) => (prev === id ? null : id));
    setProgress("");
  };

  const ageGroups = Array.from(
    new Set(areas.flatMap((a) => (a.learning_points ?? []).map((lp) => lp.age_group).filter(Boolean))) as Set<string>
  );

  if (!open) return null;

  // The sub-goal is recorded through its first matching milestone (the action
  // resolves the learning point from it), plus the explicit learning point id.
  const attachedMilestoneId = subGoalMilestones[0]?.id ?? null;
  const progressLabel = progress ? tr(dict, `learning.${progress.toLowerCase()}`) : "";
  const body = [observation.trim(), progress && selectedSubGoal ? `${t("learning.progress")}: ${progress}` : "", nextSteps.trim() ? `${t("learning.nextSteps")}: ${nextSteps.trim()}` : ""]
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
                {childChoices.map((c) => (
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
              {/* KID-86 #5: exactly two kinds — Observations and Assessments. */}
              <option value="observation">{t("learning.kindObservations")}</option>
              <option value="assessment">{t("learning.kindAssessments")}</option>
            </select>
          </div>

          <input type="hidden" name="body" value={body} />
          <input type="hidden" name="ageGroup" value={ageGroup} />
          <input type="hidden" name="title" value={nextSteps.trim() ? `${t("learning.nextSteps")}: ${nextSteps.trim()}` : ""} />
          <input type="hidden" name="progress" value={progress} />
          {selectedSubGoal && <input type="hidden" name="learningPointId" value={selectedSubGoal} />}
          {attachedMilestoneId && <input type="hidden" name="goalIds" value={attachedMilestoneId} />}

          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <label className="small muted" style={{ display: "inline-flex", gap: 6, cursor: "pointer" }} title={t("learning.attachMedia")}>
                <span aria-hidden="true">📷 🎞 📎</span> {t("learning.attach")}
                <input type="file" name="attachments" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} />
              </label>
              {selectedSubGoal && (
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
                <div className="muted small" style={{ marginBottom: 4 }}>{t("learning.subGoals")}</div>
                {subGoalsInView.length === 0 && <p className="muted small">{t("learning.noSubGoals")}</p>}
                {subGoalsInView.map((lp) => {
                  const selected = selectedSubGoal === lp.id;
                  return (
                    <button
                      key={lp.id}
                      type="button"
                      onClick={() => selectSubGoal(lp.id)}
                      title={lp.name}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        width: "100%",
                        textAlign: "start",
                        padding: "7px 9px",
                        borderRadius: 6,
                        border: selected ? "1.5px solid var(--brand-primary)" : "1px solid var(--color-border)",
                        background: selected
                          ? "color-mix(in srgb, var(--brand-primary) 12%, transparent)"
                          : "var(--color-surface)",
                        color: "var(--color-text)",
                        cursor: "pointer",
                        fontSize: 13,
                        marginBottom: 4,
                      }}
                    >
                      <span className={selected ? "badge badge-green" : "badge badge-gray"} style={{ flexShrink: 0 }}>
                        {selected ? "✓" : ""}
                      </span>
                      <strong style={{ fontWeight: selected ? 700 : 500 }}>{lp.name}</strong>
                    </button>
                  );
                })}
                {selectedSubGoal && (
                  <div className="mt-2">
                    <div className="muted small" style={{ marginBottom: 4 }}>{t("learning.subGoalMilestones")}</div>
                    {subGoalMilestones.length === 0 && <p className="muted small">{t("learning.noMilestones")}</p>}
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                      {subGoalMilestones.map((m) => (
                        <li key={m.id} style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 2 }}>
                          {m.name}
                          {m.age_group ? <span className="muted small"> · {m.age_group}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
            {selectedSubGoal && (
              <div className="mt-3">
                <div className="label">{t("learning.gradePrompt")}</div>
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
              <button type="button" className="btn btn-ghost small" onClick={() => { setSelectedSubGoal(null); setProgress(""); }}>{t("learning.cancel")}</button>
              <button type="button" className="btn btn-primary small" onClick={() => setShowGoals(false)}>{t("learning.addSelected", { count: selectedSubGoal ? 1 : 0 })}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}