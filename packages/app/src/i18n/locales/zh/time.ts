export default {
  justNow: "刚刚",
  relative: {
    secondsAgo: "{{value}} 秒前",
    minutesAgo: "{{value}} 分钟前",
    hoursAgo: "{{value}} 小时前",
    daysAgo: "{{value}} 天前",
    monthsAgo: "{{value}} 个月前",
    yearsAgo: "{{value}} 年前",
  },
  duration: {
    seconds: "{{value}} 秒",
    minutes: "{{value}} 分",
    minutesSeconds: "{{minutes}} 分 {{seconds}} 秒",
    hours: "{{value}} 小时",
    hoursMinutes: "{{hours}} 小时 {{minutes}} 分",
  },
} as const;
