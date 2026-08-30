export function pluralize(count: number, word: string, pluralForm: string) {
  // 1. Initialize the plural rules for the language
  const pr = new Intl.PluralRules('en')

  // 2. Get the category ('one' or 'other' for English)
  const rule = pr.select(count)

  // 3. Return the correct word based on the category
  return rule === 'one' ? `${count} ${word}` : `${count} ${pluralForm}`
}
