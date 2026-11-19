import { publicProfileLocation, type PublicLocation } from './formatPublicLocation';

export function PublicProfileLocation({ city, countryCode }: PublicLocation) {
  const label = publicProfileLocation({ city, countryCode });
  return label ? <p className="public-profile-location">{label}</p> : null;
}
