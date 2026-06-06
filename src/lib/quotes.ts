// A small library of inspirational quotes printed at the bottom of each
// drink label. Keep them short — labels are tiny.
export const QUOTES: string[] = [
  "Today is a great day for great coffee.",
  "Bloom where you are planted.",
  "Small steps every day.",
  "Be the reason someone smiles today.",
  "Stay grounded, stay grateful.",
  "Make today ridiculously amazing.",
  "Sip slowly. Live fully.",
  "Good vibes, great coffee.",
  "You are exactly where you need to be.",
  "Brew the change you wish to see.",
  "One cup at a time.",
  "Wake up. Kick ass. Repeat.",
  "Stay close to people who feel like sunshine.",
  "Espresso yourself.",
  "Life happens, coffee helps.",
  "Be the energy you want to attract.",
  "Stir up some kindness today.",
  "Inhale courage, exhale doubt.",
  "Today's good mood is sponsored by coffee.",
  "Keep your face to the sunshine.",
  "Dream big. Work hard. Stay humble.",
  "Mondays are for fresh starts.",
  "Pour kindness everywhere you go.",
  "Brewed with love.",
  "You're doing better than you think.",
];

export function randomQuote(): string {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}
