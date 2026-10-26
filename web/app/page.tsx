"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Slot, SlotStatus } from "@/lib/naver";

const BOOKING_URL = "https://m.booking.naver.com/booking/10/bizes/1056959/items/8046643";
const WEEKDAYS = "일월화수목금토";
const END_DATE = "2026-12-31";
const OPEN_HOUR = 10; // 10:00부터
const CLOSE_HOUR = 20; // 20:00까지
const RENT_HOURS = 2; // 대여 단위(시간)
const BUFFER_HOURS = 1; // 기존 예약·운영안함과의 최소 간격(시간)
const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => i + OPEN_HOUR);
const STALE_MS = 5 * 60_000; // 탭으로 돌아왔을 때 이보다 오래됐으면 다시 조회

// 화면 표시용 상태: 빈 칸을 2시간 대여에 쓸 수 있는지(free) / 없는지(unusable)로 나눔
type CellStatus = "free" | "unusable" | "booked" | "closed";
const CELL_LABEL: Record<CellStatus, string> = {
  free: "대여 가능",
  unusable: "비었지만 간격 부족",
  booked: "예약됨",
  closed: "운영안함",
};

type Day = { date: string; wd: string; starts: number[]; cells: (CellStatus | undefined)[] };
type Weekend = { key: string; days: Day[] };
type Window = { from: number; to: number };

function nowKST() {
  const d = new Date(Date.now() + 9 * 3600_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(date: string) {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400_000) + 1;
}

const pad = (h: number) => String(h).padStart(2, "0");
const md = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`;
const longDate = (date: string) =>
  `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 (${weekday(date)})`;

// 대여 시작 가능 시각: [h, h+RENT) 가 모두 비어 있고,
// 앞뒤 BUFFER 시간 안에 예약됨/운영안함이 없어야 함 (영업시간 밖 칸도 실제 상태로 판단)
function bookableStarts(row: Map<number, SlotStatus>, minStart: number) {
  const starts: number[] = [];
  for (let h = Math.max(OPEN_HOUR, minStart); h + RENT_HOURS <= CLOSE_HOUR; h++) {
    let ok = true;
    for (let t = h - BUFFER_HOURS; t < h + RENT_HOURS + BUFFER_HOURS && ok; t++) {
      const st = row.get(t);
      const inRent = t >= h && t < h + RENT_HOURS;
      ok = inRent ? st === "free" : st === undefined || st === "free";
    }
    if (ok) starts.push(h);
  }
  return starts;
}

// 연속된 시작 시각을 하나의 이용 가능 구간으로 합침 (예: 10,11,12시 시작 → 10:00–14:00)
function toWindows(starts: number[]) {
  const out: Window[] = [];
  for (const h of starts) {
    const last = out[out.length - 1];
    if (last && h === last.to - RENT_HOURS + 1) last.to = h + RENT_HOURS;
    else out.push({ from: h, to: h + RENT_HOURS });
  }
  return out;
}

function WindowChip({ w, large }: { w: Window; large?: boolean }) {
  const flexible = w.to - w.from > RENT_HOURS;
  return (
    <span
      className={`chip${large ? " chip-lg" : ""}`}
      title={flexible ? `${pad(w.from)}~${pad(w.to - RENT_HOURS)}시 사이에 시작` : undefined}
    >
      {pad(w.from)}:00–{pad(w.to)}:00
      {flexible && <small>중 {RENT_HOURS}시간</small>}
    </span>
  );
}

function Timeline({ day }: { day: Day }) {
  const label = day.cells
    .map((st, i) => `${HOURS[i]}시 ${st ? CELL_LABEL[st] : "정보 없음"}`)
    .join(", ");
  return (
    <div className="timeline" role="img" aria-label={label}>
      {day.cells.map((st, i) => (
        <span
          key={HOURS[i]}
          className={`seg ${st ?? "none"}`}
          title={`${pad(HOURS[i])}:00 ${st ? CELL_LABEL[st] : ""}`}
        />
      ))}
    </div>
  );
}

function HourScale() {
  const marks = HOURS.filter((h) => (h - OPEN_HOUR) % 2 === 0).concat(CLOSE_HOUR);
  return (
    <div className="hour-scale" aria-hidden>
      <span />
      <div>
        {marks.map((h) => (
          <span key={h} style={{ left: `${((h - OPEN_HOUR) / (CLOSE_HOUR - OPEN_HOUR)) * 100}%` }}>
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}

function DayRow({ day }: { day: Day }) {
  const windows = toWindows(day.starts);
  return (
    <div className="day">
      <div className={`day-label ${day.wd === "토" ? "sat" : "sun"}`}>
        <span className="wd">{day.wd}</span>
        <span className="md">{md(day.date)}</span>
      </div>
      <Timeline day={day} />
      <div className="slots">
        {windows.length ? (
          windows.map((w) => <WindowChip key={w.from} w={w} />)
        ) : (
          <span className="none">대여 가능한 시간 없음</span>
        )}
      </div>
    </div>
  );
}

function WeekendCard({ weekend, index, onlyAvailable }: { weekend: Weekend; index: number; onlyAvailable: boolean }) {
  const { days } = weekend;
  const available = days.filter((d) => d.starts.length).length;
  const shown = onlyAvailable ? days.filter((d) => d.starts.length) : days;
  const tag = index === 0 ? "이번 주말" : index === 1 ? "다음 주말" : null;
  return (
    <section className="weekend">
      <header className="weekend-head">
        <h2>
          {md(days[0].date)}
          {days.length > 1 && ` – ${md(days[days.length - 1].date)}`}
          {tag && <span className="tag">{tag}</span>}
        </h2>
        <span className={`count${available ? "" : " zero"}`}>{available ? `${available}일 가능` : "마감"}</span>
      </header>
      <HourScale />
      {shown.map((d) => (
        <DayRow key={d.date} day={d} />
      ))}
    </section>
  );
}

function NextUp({ day, more }: { day: Day; more: number }) {
  return (
    <section className="next">
      <p className="next-eyebrow">가장 빠른 대여 가능일</p>
      <p className="next-date">{longDate(day.date)}</p>
      <div className="next-slots">
        {toWindows(day.starts).map((w) => (
          <WindowChip key={w.from} w={w} large />
        ))}
      </div>
      <a className="cta" href={BOOKING_URL} target="_blank" rel="noreferrer">
        네이버 예약에서 예약하기
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
          <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      {more > 0 && <p className="next-more">이 외에도 {more}일 더 대여할 수 있어요</p>}
    </section>
  );
}

function Legend() {
  return (
    <ul className="legend">
      {(Object.keys(CELL_LABEL) as CellStatus[]).map((s) => (
        <li key={s}>
          <i className={`seg ${s}`} />
          {CELL_LABEL[s]}
        </li>
      ))}
    </ul>
  );
}

function Skeleton() {
  return (
    <div className="weekends" aria-busy="true" aria-label="불러오는 중">
      <div className="skeleton hero" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton card" />
      ))}
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={spinning ? "spin" : undefined} viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Home() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const lastFetch = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = nowKST().date;
      const res = await fetch(`/api/schedule?start=${start}&days=${daysBetween(start, END_DATE)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSlots(json.slots);
      setFetchedAt(json.fetchedAt);
      lastFetch.current = Date.now();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 휴대폰에서 다른 앱 갔다가 돌아오면 오래된 데이터 자동 갱신
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastFetch.current > STALE_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const { days, weekends } = useMemo(() => {
    const now = nowKST();
    const grid = new Map<string, Map<number, SlotStatus>>();
    for (const s of slots) {
      const wd = weekday(s.date);
      if ((wd !== "토" && wd !== "일") || s.date < now.date) continue;
      if (!grid.has(s.date)) grid.set(s.date, new Map());
      grid.get(s.date)!.set(s.hour, s.status);
    }

    const days: Day[] = [...grid.keys()].sort().map((date) => {
      const row = grid.get(date)!;
      // 오늘이면 이미 지난 시각에는 시작할 수 없음
      const starts = bookableStarts(row, date === now.date ? now.hour + 1 : OPEN_HOUR);
      const usable = new Set(starts.flatMap((h) => Array.from({ length: RENT_HOURS }, (_, i) => h + i)));
      const cells = HOURS.map((h): CellStatus | undefined => {
        const st = row.get(h);
        if (st === "free") return usable.has(h) ? "free" : "unusable";
        return st;
      });
      return { date, wd: weekday(date), starts, cells };
    });

    const byKey = new Map<string, Day[]>();
    for (const d of days) {
      const key = d.wd === "일" ? addDays(d.date, -1) : d.date;
      byKey.set(key, [...(byKey.get(key) ?? []), d]);
    }
    const weekends: Weekend[] = [...byKey].map(([key, days]) => ({ key, days }));
    return { days, weekends };
  }, [slots]);

  const availableDays = days.filter((d) => d.starts.length);
  const first = availableDays[0];
  const visible = onlyAvailable ? weekends.filter((w) => w.days.some((d) => d.starts.length)) : weekends;
  const updated =
    fetchedAt && new Date(fetchedAt).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-text">
          <p className="eyebrow">앙트레블 강연장</p>
          <h1>주말 대여 가능 시간</h1>
        </div>
        <button className="icon-btn" onClick={load} disabled={loading} aria-label="새로고침">
          <RefreshIcon spinning={loading} />
        </button>
      </header>

      <main className="content">
        <p className="conditions">
          <span>토·일</span>
          <span>
            {OPEN_HOUR}–{CLOSE_HOUR}시
          </span>
          <span>{RENT_HOURS}시간 단위</span>
          <span>앞뒤 {BUFFER_HOURS}시간 간격</span>
          <span>{md(END_DATE)}까지</span>
        </p>

        {error && (
          <div className="alert" role="alert">
            <span>불러오지 못했어요. {error}</span>
            <button onClick={load}>다시 시도</button>
          </div>
        )}

        {loading && !slots.length ? (
          <Skeleton />
        ) : (
          slots.length > 0 && (
            <>
              {first ? (
                <NextUp day={first} more={availableDays.length - 1} />
              ) : (
                <section className="empty">
                  <p className="empty-title">{md(END_DATE)}까지 대여 가능한 주말이 없어요</p>
                  <p>예약이 취소되면 자리가 생길 수 있어요. 나중에 다시 확인해 보세요.</p>
                </section>
              )}

              <div className="toolbar">
                <div className="segmented" role="group" aria-label="보기 필터">
                  <button aria-pressed={!onlyAvailable} onClick={() => setOnlyAvailable(false)}>
                    전체 <b>{days.length}</b>
                  </button>
                  <button aria-pressed={onlyAvailable} onClick={() => setOnlyAvailable(true)}>
                    가능한 날 <b>{availableDays.length}</b>
                  </button>
                </div>
                <Legend />
              </div>

              <div className="weekends">
                {visible.map((w) => (
                  <WeekendCard key={w.key} weekend={w} index={weekends.indexOf(w)} onlyAvailable={onlyAvailable} />
                ))}
              </div>
            </>
          )
        )}

        <footer className="footnote">
          {updated && <p>{updated} 기준 · 네이버 예약 데이터</p>}
          <p>
            ‘운영안함’은 업체가 막아둔 시간으로, 네이버 외 채널 예약일 수 있어요. 비공식 API를 사용하므로 네이버
            측 변경 시 동작하지 않을 수 있어요.
          </p>
        </footer>
      </main>
    </div>
  );
}
