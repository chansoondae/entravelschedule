#!/usr/bin/env python3
"""네이버 예약 '앙트레블' 강연장의 시간대별 예약 가능 여부 조회.

비공식 API(m.booking.naver.com/graphql)를 사용하므로 네이버 측 변경 시 동작하지 않을 수 있음.

사용법:
    python3 check_availability.py                # 오늘부터 7일
    python3 check_availability.py 2026-11-01 14  # 지정일부터 14일
"""
import json
import ssl
import sys
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta

BUSINESS_TYPE_ID = 10
BUSINESS_ID = "1056959"
BIZ_ITEM_ID = "8046643"
URL = "https://m.booking.naver.com/graphql?opName=schedule"
QUERY = """query schedule($scheduleParams: ScheduleParams) {
  schedule(input: $scheduleParams) {
    bizItemSchedule {
      hourly { unitStartTime unitBookingCount unitStock isUnitSaleDay isUnitBusinessDay duration }
    }
  }
}"""
WEEKDAYS = "월화수목금토일"

try:  # python.org 설치본은 시스템 인증서를 못 찾는 경우가 있어 certifi 우선 사용
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()


def fetch_hourly(start: date, days: int):
    end = start + timedelta(days=days - 1)
    body = {
        "operationName": "schedule",
        "variables": {
            "scheduleParams": {
                "businessTypeId": BUSINESS_TYPE_ID,
                "businessId": BUSINESS_ID,
                "bizItemId": BIZ_ITEM_ID,
                "startDateTime": f"{start}T00:00:00",
                "endDateTime": f"{end}T23:59:59",
                "fixedTime": True,
                "includesHolidaySchedules": True,
            }
        },
        "query": QUERY,
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36",
            "referer": f"https://m.booking.naver.com/booking/{BUSINESS_TYPE_ID}/bizes/{BUSINESS_ID}/items/{BIZ_ITEM_ID}",
        },
    )
    with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as resp:
        data = json.load(resp)
    if data.get("errors"):
        raise RuntimeError(data["errors"])
    return data["data"]["schedule"]["bizItemSchedule"]["hourly"]


def status(slot):
    if not (slot["isUnitSaleDay"] and slot["isUnitBusinessDay"]):
        return "-"  # 운영/판매 안 함
    if slot["unitBookingCount"] >= slot["unitStock"]:
        return "●"  # 예약됨
    return "○"  # 비어있음


def main():
    start = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date.today()
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 7

    grid = defaultdict(dict)  # date -> hour -> status
    for slot in fetch_hourly(start, days):
        t = datetime.strptime(slot["unitStartTime"], "%Y-%m-%d %H:%M:%S")
        grid[t.date()][t.hour] = status(slot)

    hours = sorted({h for row in grid.values() for h in row})
    print("○ 비어있음  ● 예약됨  - 운영안함\n")
    print("날짜          " + " ".join(f"{h:02d}" for h in hours))
    for d in sorted(grid):
        cells = " ".join(f"{grid[d].get(h, ' '):>2}" for h in hours)
        print(f"{d} ({WEEKDAYS[d.weekday()]}) {cells}")

    print("\n[빈 시간대 요약]")
    for d in sorted(grid):
        free = [h for h in hours if grid[d].get(h) == "○"]
        if not free:
            print(f"{d} ({WEEKDAYS[d.weekday()]}): 없음")
            continue
        # 연속 구간으로 묶기
        ranges, s = [], free[0]
        for a, b in zip(free, free[1:] + [None]):
            if b != a + 1:
                ranges.append(f"{s:02d}:00-{a + 1:02d}:00")
                s = b
        print(f"{d} ({WEEKDAYS[d.weekday()]}): {', '.join(ranges)}")


if __name__ == "__main__":
    main()
