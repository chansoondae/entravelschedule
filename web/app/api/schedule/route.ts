import { NextRequest, NextResponse } from "next/server";
import { fetchSchedule } from "@/lib/naver";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 120;

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get("start") ?? "";
  const days = Number(req.nextUrl.searchParams.get("days") ?? 7);

  if (!DATE_RE.test(start) || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return NextResponse.json(
      { error: `start=YYYY-MM-DD, days=1~${MAX_DAYS} 형식이어야 합니다.` },
      { status: 400 },
    );
  }

  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + days - 1);
  const end = endDate.toISOString().slice(0, 10);

  try {
    const slots = await fetchSchedule(start, end);
    return NextResponse.json({ slots, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
