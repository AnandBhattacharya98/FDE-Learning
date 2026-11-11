export const TYPE_LABEL = {
  overview: "Overview",
  lesson: "Lesson",
  reading: "Reading",
  practice: "Practice quiz",
  quiz: "Graded quiz",
  project: "Assignment",
  voice: "Voice quiz",
};

export const MANUAL = new Set(["overview", "lesson", "reading"]);

export const flatItems = (week) => week.modules.flatMap((m) => m.items.map((i) => ({ ...i, module: m })));
