import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { publicProfileLocation } from './formatPublicLocation';
import { PublicProfileLocation } from './PublicProfileLocation';

it.each([
  [' Buenos Aires ', ' ar ', 'Buenos Aires, Argentina'],
  ['Córdoba', 'ES', 'Córdoba, España'],
  [null, 'DE', 'Alemania'], [null, 'US', 'Estados Unidos'],
  ['Rosario', 'XX', 'Rosario'], ['Rosario', '123', 'Rosario'],
  [null, 'EU', null], [null, 'ZZ', null], [null, 'invalid', null],
  ['  ', null, null], [null, null, null], ['Rosario', null, 'Rosario'],
])('formats declared city %s and country %s safely', (city, countryCode, expected) => {
  expect(publicProfileLocation({ city, countryCode })).toBe(expected);
  const { container } = render(<PublicProfileLocation city={city} countryCode={countryCode}/>);
  if (expected) expect(screen.getByText(expected)).toBeVisible();
  else expect(container).toBeEmptyDOMElement();
});
it('renders user text as text', () => {
  const { container } = render(<PublicProfileLocation city="<img src=x>" countryCode="AR"/>);
  expect(screen.getByText('<img src=x>, Argentina')).toBeVisible();
  expect(container.querySelector('img')).toBeNull();
});
