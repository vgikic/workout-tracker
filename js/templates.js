// Default workout templates. Each exercise:
//   name, sets, rest (seconds), myoLast (last set is a myo-rep match set),
//   supersetWithPrev (this exercise is alternated set-by-set with the previous one)
// Templates are copied into app state on first run and can be edited from Settings.

function ex(name, sets, rest, opts = {}) {
  return { id: slug(name), name, sets, rest, myoLast: false, supersetWithPrev: false, ...opts };
}

export function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const DEFAULT_TEMPLATES = [
  {
    id: 'w1', name: 'Push A', subtitle: 'Incline DB press · Chest press · Triceps · Shoulders',
    exercises: [
      ex('Incline dumbbell bench press (30°)', 3, 180),
      ex('Machine chest press', 3, 180),
      ex('Overhead tricep extension', 3, 120),
      ex('Tricep pushdown', 3, 120),
      ex('Dumbbell shoulder press', 3, 180),
      ex('Dumbbell side laterals', 3, 180, { supersetWithPrev: true, myoLast: true }),
    ],
  },
  {
    id: 'w2', name: 'Legs A', subtitle: 'Squat · Quads · Hamstrings · Calves',
    exercises: [
      ex('Squat', 2, 300),
      ex('Single leg extension', 3, 120),
      ex('Leg curl', 3, 120),
      ex('Back extension (ham/glute)', 2, 120),
      ex('Standing calf raise', 4, 90),
    ],
  },
  {
    id: 'w3', name: 'Pull A', subtitle: 'Biceps · Pulldown then Row · Rear delts · Forearms',
    exercises: [
      ex('Incline dumbbell curl', 3, 120, { myoLast: true }),
      ex('Single arm cable curl', 3, 120, { myoLast: true }),
      ex('Lat pulldown', 3, 180),
      ex('Machine row', 3, 180),
      ex('Rear delt cable face pull', 4, 120),
      ex('Forearm machine curl', 4, 90),
    ],
  },
  {
    id: 'w4', name: 'Push B', subtitle: 'Triceps first · Chest press · Cable fly · Shoulders',
    exercises: [
      ex('Overhead tricep extension', 3, 120, { myoLast: true }),
      ex('Tricep pushdown', 3, 120),
      ex('Machine chest press', 3, 180),
      ex('Cable fly', 2, 120, { myoLast: true }),
      ex('Dumbbell shoulder press', 3, 180),
      ex('Dumbbell side laterals', 3, 180, { supersetWithPrev: true, myoLast: true }),
    ],
  },
  {
    id: 'w5', name: 'Legs B', subtitle: 'Leg press · SLDL · Hamstrings · Glutes',
    exercises: [
      ex('Single leg press', 3, 180, { myoLast: true }),
      ex('Single leg extension', 2, 120, { myoLast: true }),
      ex('Stiff leg deadlift', 2, 300),
      ex('Leg curl', 3, 120),
      ex('Glute machine', 3, 120),
    ],
  },
  {
    id: 'w6', name: 'Pull B', subtitle: 'Biceps · Row then Pulldown · Rear delts · Forearms',
    exercises: [
      ex('Incline dumbbell curl', 3, 120, { myoLast: true }),
      ex('Single arm cable curl', 3, 120, { myoLast: true }),
      ex('Machine row', 3, 180),
      ex('Lat pulldown', 3, 180),
      ex('Rear delt cable face pull', 4, 120),
      ex('Forearm machine curl', 4, 90),
    ],
  },
];
