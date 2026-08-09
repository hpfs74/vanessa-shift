/** The six pay parameters as they are labelled on screen. Two screens show
 *  them — Stipendio to edit, Profilo to read — and a label changed in one
 *  place only would make the two disagree about the same number. */

import type { PaySettings } from '@vanessa/core';

export interface PayField {
  readonly key: keyof PaySettings;
  readonly label: string;
  readonly isPercentage: boolean;
}

export const PAY_FIELDS: readonly PayField[] = [
  { key: 'hourlyRate', label: 'Tariffa oraria lorda (€)', isPercentage: false },
  { key: 'saturdayPremium', label: 'Maggiorazione sabato (%)', isPercentage: true },
  { key: 'sundayPremium', label: 'Maggiorazione domenica (%)', isPercentage: true },
  { key: 'holidayPremium', label: 'Maggiorazione festivo (%)', isPercentage: true },
  { key: 'thirteenthAccrual', label: 'Rateo 13a (%)', isPercentage: true },
  { key: 'netRatio', label: 'Coefficiente netto/lordo (%)', isPercentage: true },
];
