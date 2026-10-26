// 네이버 예약 비공식 API(m.booking.naver.com/graphql) 클라이언트.
// 네이버 측 변경 시 동작하지 않을 수 있음.

export const BUSINESS_TYPE_ID = 10;
export const BUSINESS_ID = "1056959";
export const BIZ_ITEM_ID = "8046643";
export const BOOKING_URL = `https://m.booking.naver.com/booking/${BUSINESS_TYPE_ID}/bizes/${BUSINESS_ID}/items/${BIZ_ITEM_ID}`;

const QUERY = `query schedule($scheduleParams: ScheduleParams) {
  schedule(input: $scheduleParams) {
    bizItemSchedule {
      hourly { unitStartTime unitBookingCount unitStock isUnitSaleDay isUnitBusinessDay duration }
    }
  }
}`;

type HourlySlot = {
  unitStartTime: string; // "YYYY-MM-DD HH:mm:ss"
  unitBookingCount: number;
  unitStock: number;
  isUnitSaleDay: boolean;
  isUnitBusinessDay: boolean;
};

export type SlotStatus = "free" | "booked" | "closed";
export type Slot = { date: string; hour: number; status: SlotStatus };

function statusOf(s: HourlySlot): SlotStatus {
  if (!(s.isUnitSaleDay && s.isUnitBusinessDay)) return "closed";
  if (s.unitBookingCount >= s.unitStock) return "booked";
  return "free";
}

export async function fetchSchedule(start: string, end: string): Promise<Slot[]> {
  const res = await fetch("https://m.booking.naver.com/graphql?opName=schedule", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36",
      referer: BOOKING_URL,
    },
    body: JSON.stringify({
      operationName: "schedule",
      variables: {
        scheduleParams: {
          businessTypeId: BUSINESS_TYPE_ID,
          businessId: BUSINESS_ID,
          bizItemId: BIZ_ITEM_ID,
          startDateTime: `${start}T00:00:00`,
          endDateTime: `${end}T23:59:59`,
          fixedTime: true,
          includesHolidaySchedules: true,
        },
      },
      query: QUERY,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`네이버 응답 오류: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  const hourly: HourlySlot[] = json.data.schedule.bizItemSchedule.hourly;
  return hourly.map((s) => {
    const [date, time] = s.unitStartTime.split(" ");
    return { date, hour: Number(time.slice(0, 2)), status: statusOf(s) };
  });
}
