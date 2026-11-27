// Paths from Android drawable/ic_send, ic_mic, ic_close and ic_stop (24dp).
const paths = {
  heartOutline: 'M12.1,18.55L12,18.65L11.89,18.55C7.14,14.24 4,11.39 4,8.5C4,6.5 5.5,5 7.5,5C9.04,5 10.54,5.99 11.07,7.36H12.94C13.46,5.99 14.96,5 16.5,5C18.5,5 20,6.5 20,8.5C20,11.39 16.86,14.24 12.1,18.55Z',
  heart: 'M12,21.35L10.55,20.03C5.4,15.36 2,12.28 2,8.5C2,5.42 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.42 22,8.5C22,12.28 18.6,15.36 13.45,20.04L12,21.35Z',
  send: 'M2.01,21L23,12L2.01,3L2,10L17,12L2,14L2.01,21Z',
  mic: 'M12,14c1.66,0 3,-1.34 3,-3V5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6c0,1.66 1.34,3 3,3zM17.3,11c0,3 -2.54,5.1 -5.3,5.1S6.7,14 6.7,11H5c0,3.41 2.72,6.23 6,6.72V21h2v-3.28c3.28,-0.49 6,-3.31 6,-6.72h-1.7z',
  close: 'M18.3,5.71 12,12l6.3,6.29 -1.41,1.41L10.59,13.41 4.29,19.71 2.88,18.3 9.17,12 2.88,5.71 4.29,4.29 10.59,10.59 16.89,4.29z',
  stop: 'M6,6h12v12H6z',
  more: 'M12,8a2,2 0 1,0 0,-4a2,2 0 0,0 0,4zM12,14a2,2 0 1,0 0,-4a2,2 0 0,0 0,4zM12,20a2,2 0 1,0 0,-4a2,2 0 0,0 0,4z',
  next: 'M9,6l6,6l-6,6l-1.4,-1.4L12.2,12L7.6,7.4z',
  play: 'M8,5v14l11,-7z',
  pause: 'M6,19h4V5H6v14zM14,5v14h4V5h-4z',
};
export function ChatIcon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24"><path {...(name === 'heartOutline' ? { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' as const } : { fill: 'currentColor' })} d={paths[name]} /></svg>;
}
