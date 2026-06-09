// Relative-time and duration words. The number is interpolated via `{{value}}` (a plain
// variable, NOT i18next's special `count`), because these units don't inflect by quantity
// in the languages we support — keeping them out of the plural machinery.
export default {
  justNow: "just now",
  relative: {
    secondsAgo: "{{value}}s ago",
    minutesAgo: "{{value}}m ago",
    hoursAgo: "{{value}}h ago",
    daysAgo: "{{value}}d ago",
    monthsAgo: "{{value}}mo ago",
    yearsAgo: "{{value}}y ago",
  },
  duration: {
    seconds: "{{value}}s",
    minutes: "{{value}}m",
    minutesSeconds: "{{minutes}}m {{seconds}}s",
    hours: "{{value}}h",
    hoursMinutes: "{{hours}}h {{minutes}}m",
  },
} as const;
