"use client";

import { useMemo, useState } from "react";
import { createObservationAction } from "@/lib/actions";

type Milestone = { id: string; name: string; description?: string; age_group?: string; learning_point_name?: string };
type LearningPoint = { id: string; name: string; age_group?: string; milestones?: Milestone[] };
type Area = { id: string; name: string; learning_points?: LearningPoint[] };
type Child = { id: string; first_name: string; last_name: string; dob?: string };

const PROGRESS_LEVELS = ["Emerging", "Developing", "Secure"] as const;

// KID-53 #4, KID-55 #7/#8/#9: observation modal — By/To row, observation +
// next-steps columns, file attach input, Post, and the "Add curriculum
// goals" picker (areas left, age bands, single goal radio + progress level,
// Cancel/Add selected).
export default function ObservationModal({
  children,
  areas,
  byName,
  defaultChildId,
  defaultAgeGroup,
  open,
  onClose,
}: {
  children: Child[];
  areas: Area[];
  byName: string;
  defaultChildId?: string;
  defaultAgeGroup?: string;
  open: boolean;
  onClose: () => void;
}) {
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
  const body = [observation.trim(), progress && chosenGoal ? `Progress: ${progress}` : "", nextSteps.trim() ? `Next steps: ${nextSteps.trim()}` : ""]
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
          <h3 style={{ margin: 0 }}>New observation</h3>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 20, color: "var(--color-muted)" }} aria-label="Close">
            ×
          </button>
        </div>

        <form action={createObservationAction}>
          <div className="row" style={{ alignItems: "center" }}>
            <div className="col field" style={{ minWidth: 0 }}>
              <label className="label">By</label>
              <input className="input" value={byName} readOnly disabled style={{ background: "color-mix(in srgb, var(--color-surface) 60%, #e2e8f0)" }} />
            </div>
            <div className="col field">
              <label className="label">To</label>
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
              <label className="label">Observation</label>
              <textarea className="textarea" name="observation" value={observation} onChange={(e) => setObservation(e.target.value)} required placeholder="What did you observe?" style={{ minHeight: 96 }} />
            </div>
            <div className="col field">
              <label className="label">Next steps</label>
              <textarea
                className="textarea"
                value={nextSteps}
                onChange={(e) => setNextSteps(e.target.value)}
                placeholder="What comes next for this child?"
                style={{ minHeight: 96 }}
              />
            </div>
          </div>

          <div className="field">
            <label className="label">Kind</label>
            <select className="select" name="kind" defaultValue="observation" style={{ maxWidth: 200 }}>
              <option value="observation">Observation</option>
              <option value="milestone">Milestone</option>
              <option value="goal">Goal</option>
              <option value="assessment">Assessment</option>
            </select>
          </div>

          <input type="hidden" name="body" value={body} />
          <input type="hidden" name="ageGroup" value={ageGroup} />
          <input type="hidden" name="title" value={nextSteps.trim() ? `Next steps: ${nextSteps.trim()}` : ""} />
          <input type="hidden" name="progress" value={progress} />
          {selectedGoal && <input type="hidden" name="goalIds" value={selectedGoal} />}
          {selectedGoal && <input type="hidden" name="learningPointId" value="" />}

          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <label className="small muted" style={{ display: "inline-flex", gap: 6, cursor: "pointer" }} title="Attach media or files">
                <span aria-hidden="true">📷 🎞 📎</span> Attach
                <input type="file" name="attachments" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} />
              </label>
              {selectedGoal && (
                <button type="button" className="badge badge-green" style={{ cursor: "default" }}>
                  1 curriculum goal attached{progress ? ` · ${progress}` : ""}
                </button>
              )}
              <button type="button" onClick={() => setShowGoals((s) => !s)} className="btn btn-ghost small">
                {showGoals ? "Hide curriculum goals" : "+ Add curriculum goals"}
              </button>
            </div>
            <button className="btn btn-primary" type="submit">Post</button>
          </div>
        </form>

        {showGoals && (
          <div className="card mt-3" style={{ borderColor: "var(--color-border)", background: "color-mix(in srgb, var(--color-surface) 85%, #eef2ff)" }}>
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <h4 className="subtitle" style={{ margin: 0 }}>Add curriculum goals</h4>
              <div className="row" style={{ gap: 6 }}>
                {ageGroup === "" && <span className="badge badge-gray">All age bands</span>}
                {ageGroups.map((g) => (
                  <button key={g} type="button" onClick={() => setAgeGroup((prev) => (prev === g ? "" : g))} className={ageGroup === g ? "badge badge-red" : "badge badge-gray"} style={{ cursor: "pointer", border: "none", fontSize: 12 }}>
                    {String(g)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 14, marginTop: 12 }}>
              <div style={{ borderRight: "1px solid var(--color-border)", paddingRight: 10 }}>
                {areas.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAreaId(a.id)}
                    className="small"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
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
                {goalsInView.length === 0 && <p className="muted small">No curriculum goals match this area + age band.</p>}
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
                <div className="label">Age band: {ageGroup} — how is {children.find((c) => c.id === childId)?.first_name ?? "the child"} doing here? Pick one:</div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {PROGRESS_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setProgress((p) => (p === level ? "" : level))}
                      className={progress === level ? "badge badge-red" : "badge badge-gray"}
                      style={{ cursor: "pointer", border: "none", fontSize: 12 }}
                    >
                      <span style={{ marginRight: 4 }}>{level === "Emerging" ? "🟡" : level === "Developing" ? "🟢" : "🔵"}</span>
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="row mt-3" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost small" onClick={() => { setSelectedGoal(null); setProgress(""); }}>Cancel</button>
              <button type="button" className="btn btn-primary small" onClick={() => setShowGoals(false)}>Add selected ({selectedGoal ? 1 : 0})</button>
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