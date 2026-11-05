import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

type Thumb = 'min' | 'max';
const lowest = 18, highest = 99;
const percent = (age: number) => (age - lowest) / (highest - lowest) * 100;
const bracketPath = 'M19 3H7a4 4 0 0 0-4 4v18a4 4 0 0 0 4 4h12';
function Bracket() {
  return <svg className="age-bracket" width="24" height="32" viewBox="0 0 24 32" aria-hidden="true" focusable="false">
    <path className="age-bracket-halo" d={bracketPath}/><path d={bracketPath}/>
  </svg>;
}

export function AgeRangeSlider({ minAge, maxAge, disabled = false, onChange }: {
  minAge: number; maxAge: number; disabled?: boolean; onChange: (min: number, max: number) => void;
}) {
  const hint = useId();
  const minThumb = useRef<HTMLButtonElement>(null), maxThumb = useRef<HTMLButtonElement>(null);
  const values = useRef({ min: minAge, max: maxAge });
  const drafts = useRef<{ min: string | null; max: string | null }>({ min:null,max:null });
  const [numericDrafts,setNumericDrafts] = useState(drafts.current);
  const drag = useRef<{ pointerId: number; thumb: Thumb; offset: number; owner: HTMLDivElement } | null>(null);
  const release = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.owner.hasPointerCapture(current.pointerId)) current.owner.releasePointerCapture(current.pointerId);
  };
  useLayoutEffect(() => { values.current = { min: minAge, max: maxAge }; }, [minAge,maxAge]);
  useLayoutEffect(() => {
    if (disabled) {
      release();
      if (drafts.current.min !== null || drafts.current.max !== null) {
        drafts.current = { min:null,max:null }; setNumericDrafts(drafts.current);
      }
    }
  }, [disabled]);
  useEffect(() => release, []);

  const change = (thumb: Thumb, age: number) => {
    if (disabled || !Number.isFinite(age)) return;
    const current = values.current;
    const next = Math.round(age);
    const min = thumb === 'min' ? Math.max(lowest,Math.min(current.max,next)) : current.min;
    const max = thumb === 'max' ? Math.min(highest,Math.max(current.min,next)) : current.max;
    values.current = { min,max };
    if (min !== current.min || max !== current.max) onChange(min,max);
  };
  const draft = (thumb: Thumb, text: string | null) => {
    if (drafts.current[thumb] === text) return;
    const next = { ...drafts.current,[thumb]:text };
    drafts.current = next; setNumericDrafts(next);
  };
  const validNumber = (thumb: Thumb, text: string) => {
    const value = Number(text);
    return text.trim() !== '' && Number.isInteger(value) && value >= lowest && value <= highest
      && (thumb === 'min' ? value <= values.current.max : value >= values.current.min);
  };
  const commitNumber = (thumb: Thumb) => {
    const text = drafts.current[thumb];
    if (text === null) return;
    if (!disabled && text.trim() !== '' && Number.isFinite(Number(text))) change(thumb,Number(text));
    draft(thumb,null);
  };
  const numeric = (thumb: Thumb, label: string) => <label>{label}<input type="number" inputMode="numeric" step="1"
    min={thumb === 'min' ? lowest : minAge} max={thumb === 'max' ? highest : maxAge} disabled={disabled}
    value={numericDrafts[thumb] ?? (thumb === 'min' ? minAge : maxAge)} aria-describedby={hint}
    aria-invalid={numericDrafts[thumb] !== null && !validNumber(thumb,numericDrafts[thumb] ?? '')}
    onChange={event => {
      if (disabled) return;
      const text = event.target.value; draft(thumb,text);
      if (validNumber(thumb,text)) change(thumb,Number(text));
    }} onBlur={() => commitNumber(thumb)} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); commitNumber(thumb); }
      if (event.key === 'Escape') { event.preventDefault(); draft(thumb,null); }
    }}/></label>;
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, thumb: Thumb) => {
    if (disabled) return;
    const current = values.current;
    const age = current[thumb];
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowDown': next = age - 1; break;
      case 'ArrowRight': case 'ArrowUp': next = age + 1; break;
      case 'PageDown': next = age - 10; break;
      case 'PageUp': next = age + 10; break;
      case 'Home': next = thumb === 'min' ? lowest : current.min; break;
      case 'End': next = thumb === 'max' ? highest : current.max; break;
      default: return;
    }
    event.preventDefault(); change(thumb,next);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || disabled) return;
    const bounds = current.owner.getBoundingClientRect();
    if (bounds.width > 0) change(current.thumb,lowest + (event.clientX - current.offset - bounds.left) / bounds.width * (highest-lowest));
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.isPrimary === false || event.button !== 0 || drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const age = lowest + (event.clientX - bounds.left) / bounds.width * (highest-lowest);
    const target = event.target instanceof Element ? event.target.closest('[data-age-thumb]')?.getAttribute('data-age-thumb') : null;
    const beforeFocus = values.current;
    const thumb: Thumb = target === 'min' || target === 'max' ? target
      : Math.abs(age-beforeFocus.min) <= Math.abs(age-beforeFocus.max) ? 'min' : 'max';
    event.preventDefault();
    (thumb === 'min' ? minThumb : maxThumb).current?.focus({ preventScroll:true });
    // Focusing a marker can commit a numeric draft; read the resulting interval.
    const current = values.current;
    const offset = target === 'min' || target === 'max' ? event.clientX - (bounds.left + percent(current[thumb])/100*bounds.width) : 0;
    drag.current = { pointerId:event.pointerId,thumb,offset,owner:event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!target) change(thumb,age);
  };
  const endPointer = (event: PointerEvent<HTMLDivElement>) => { if (drag.current?.pointerId === event.pointerId) release(); };

  return <div className="age-slider">
    <p className="age-interval">Edad: {minAge}–{maxAge} años</p>
    <div className="age-slider-rail" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={endPointer}>
      <div className="age-slider-track" aria-hidden="true" />
      <div className="age-slider-selection" aria-hidden="true" style={{ left:`${percent(minAge)}%`,width:`${percent(maxAge)-percent(minAge)}%` }}/>
      <button ref={minThumb} className="age-thumb age-thumb-min" data-age-thumb="min" type="button" role="slider" aria-orientation="horizontal" aria-label="Edad mínima" aria-describedby={hint} aria-valuemin={lowest} aria-valuemax={maxAge} aria-valuenow={minAge} aria-valuetext={`${minAge} años`} disabled={disabled} style={{ left:`${percent(minAge)}%` }} onKeyDown={event => keyboard(event,'min')}><Bracket/></button>
      <button ref={maxThumb} className="age-thumb age-thumb-max" data-age-thumb="max" type="button" role="slider" aria-orientation="horizontal" aria-label="Edad máxima" aria-describedby={hint} aria-valuemin={minAge} aria-valuemax={highest} aria-valuenow={maxAge} aria-valuetext={`${maxAge} años`} disabled={disabled} style={{ left:`${percent(maxAge)}%` }} onKeyDown={event => keyboard(event,'max')}><Bracket/></button>
    </div>
    <div className="age-numbers">{numeric('min','Desde:')}{numeric('max','Hasta:')}</div>
    <p id={hint} className="age-slider-hint">Arrastrá [ para la mínima y ] para la máxima, o usá las flechas. Desde y Hasta permiten escribir edades de 18 a 99; se ajustan al confirmar.</p>
  </div>;
}
