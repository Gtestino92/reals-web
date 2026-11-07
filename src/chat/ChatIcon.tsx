// Paths from Android drawable/ic_send, ic_mic, ic_close and ic_stop (24dp).
const paths = {
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
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d={paths[name]} /></svg>;
}
