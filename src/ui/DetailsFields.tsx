import type { PatientDetails } from '../types';

/** Optional patient details (physio feedback round). Used when adding a patient and in the patient's Settings tab. */
export function DetailsFields({ v, set, showDiagnosis = true, showSurgery = true }: { v: PatientDetails; set: (patch: Partial<PatientDetails>) => void; showDiagnosis?: boolean; showSurgery?: boolean }) {
  const txt = (k: keyof PatientDetails, label: string, o: { type?: string; mode?: 'tel' | 'text'; ac?: string } = {}) => (
    <label className="dfield">{label}
      <input type={o.type ?? 'text'} inputMode={o.mode} autoComplete={o.ac ?? 'off'} maxLength={200} value={(v[k] as string | undefined) ?? ''} onChange={(e) => set({ [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="detailsgrid">
      {txt('phone', 'Phone', { type: 'tel', mode: 'tel', ac: 'off' })}
      <label className="dfield">Gender
        <select value={v.gender ?? ''} onChange={(e) => set({ gender: e.target.value })}>
          <option value="">Not given</option><option>Female</option><option>Male</option><option>Other</option>
        </select>
      </label>
      {txt('city', 'City')}
      {txt('occupation', 'Occupation')}
      {showDiagnosis && txt('diagnosis', 'Diagnosis')}
      {showSurgery && txt('surgeryDate', 'Surgery date', { type: 'date' })}
      {txt('surgeon', 'Surgeon')}
      <fieldset className="dchecks"><legend>Other conditions</legend>
        <label className="check"><input type="checkbox" checked={!!v.diabetes} onChange={(e) => set({ diabetes: e.target.checked })} /> Diabetes</label>
        <label className="check"><input type="checkbox" checked={!!v.bloodPressure} onChange={(e) => set({ bloodPressure: e.target.checked })} /> Blood pressure</label>
      </fieldset>
      {txt('otherConditions', 'Other conditions')}
      {txt('carerName', 'Carer name')}
      {txt('carerPhone', 'Carer phone', { type: 'tel', mode: 'tel' })}
      <label className="dfield wide">The patient's own goal
        <input maxLength={200} value={v.goal ?? ''} onChange={(e) => set({ goal: e.target.value })} placeholder="e.g. Walk to the market without a stick" />
      </label>
    </div>
  );
}
