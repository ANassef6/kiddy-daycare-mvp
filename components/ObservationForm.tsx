"use client";

import { useState } from "react";
import { createObservationAction } from "@/lib/actions";

type AgeGroup = { id: string; name: string };
type Milestone = { id: string; name: string; description: string; age_group: string };
type LearningPoint = {
  id: string;
  name: string;
  area_id: string;
  area_name: string;
  age_group: string;
  milestones: Milestone[];
};
type Child = { id: string; first_name: string; last_name: string; dob?: string };

export default function ObservationForm({
  children,
  learningPoints,
  ageByChild = {},
}: {
  children: Child[];
  learningPoints: LearningPoint[];
  ageByChild?: Record<string, string>;
}) {
  const AGE_GROUPS = ["0-1y", "1-2y", "2-3y", "3-4y", "4-5y"];

  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id ?? "");
  const [selectedAgeGroup, setSelectedAgeGroup] = useState("");
  const [selectedLearningPointId, setSelectedLearningPointId] = useState("");
  const [selectedMilestoneId, setSelectedMilestoneId] = useState("");

  // Pick points filtered by selected age group (empty = show all as fallback)
  const filteredPoints = selectedAgeGroup
    ? learningPoints.filter((lp) => lp.age_group === selectedAgeGroup || !lp.age_group)
    : learningPoints;

  // Pick milestones for the selected learning point, optionally filtered by age group
  const selectedLP = learningPoints.find((lp) => lp.id === selectedLearningPointId);
  const filteredMilestones = selectedLP
    ? selectedLP.milestones.filter(
        (m) => !selectedAgeGroup || m.age_group === selectedAgeGroup || !m.age_group
      )
    : [];

  // Group learning points by area
  const grouped: Record<string, LearningPoint[]> = {};
  for (const lp of filteredPoints) {
    const key = lp.area_name || lp.area_id;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(lp);
  }

  return (
    <form action={createObservationAction} className="observation-form">
      <div className="row">
        <div className="col field">
          <label className="label">Child</label>
          <select
            className="select"
            name="childId"
            value={selectedChildId}
            onChange={(e) => {
              setSelectedChildId(e.target.value);
              setSelectedAgeGroup(ageByChild[e.target.value] ?? "");
              setSelectedLearningPointId("");
              setSelectedMilestoneId("");
            }}
            required
          >
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name} {c.last_name}
              </option>
            ))}
          </select>
        </div>

        <div className="col field">
          <label className="label">Age group</label>
          <select
            className="select"
            name="ageGroup"
            value={selectedAgeGroup}
            onChange={(e) => {
              setSelectedAgeGroup(e.target.value);
              setSelectedLearningPointId("");
              setSelectedMilestoneId("");
            }}
          >
            <option value="">Select age group...</option>
            {AGE_GROUPS.map((ag) => (
              <option key={ag} value={ag}>
                {ag}
              </option>
            ))}
          </select>
        </div>

        <div className="col field">
          <label className="label">Kind</label>
          <select className="select" name="kind">
            <option value="observation">Observation</option>
            <option value="milestone">Milestone</option>
            <option value="goal">Goal</option>
          </select>
        </div>
      </div>

      <div className="row">
        <div className="col field">
          <label className="label">Point being observed</label>
          <select
            className="select"
            name="learningPointId"
            value={selectedLearningPointId}
            onChange={(e) => {
              setSelectedLearningPointId(e.target.value);
              setSelectedMilestoneId("");
            }}
          >
            <option value="">Select a learning point...</option>
            {Object.entries(grouped).map(([areaName, points]) => (
              <optgroup key={areaName} label={areaName}>
                {points.map((lp) => (
                  <option key={lp.id} value={lp.id}>
                    {lp.name} ({lp.age_group})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="col field">
          <label className="label">Milestone</label>
          <select
            className="select"
            name="milestoneId"
            value={selectedMilestoneId}
            onChange={(e) => setSelectedMilestoneId(e.target.value)}
          >
            <option value="">
              {selectedLearningPointId
                ? filteredMilestones.length === 0
                  ? "No milestones for this selection"
                  : "Select a milestone..."
                : "Select a learning point first"}
            </option>
            {filteredMilestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="col field">
          <label className="label">Date</label>
          <input
            className="input"
            type="date"
            name="recordedAt"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>
        <div className="col field" style={{ flex: 2 }}>
          <label className="label">Title (optional)</label>
          <input
            className="input"
            name="title"
            placeholder="e.g. First steps, Counting to ten"
          />
        </div>
      </div>

      <div className="field">
        <label className="label">Note</label>
        <textarea className="textarea" name="body" required />
      </div>

      <button className="btn btn-primary" type="submit">
        Record
      </button>
    </form>
  );
}
