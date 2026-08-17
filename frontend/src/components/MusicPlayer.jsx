import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Music2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';

const PROFILE_URL = 'https://suno.com/@playerv2';
const tracks = [
  ['NO BRAKES', 'e9c0cea3-b3ba-4720-908a-afd6536649c6'],
  ['Feel The Beat', '5fe5a2de-df0f-43ff-b377-4c1d32327841'],
  ['The Love I Have For You', '5224763e-2a26-477a-aeec-e71bad0bb43c'],
  ['You Let Me Go (Aggressive Edit)', 'db56457a-0b3b-4667-b06f-faec8615d1c5'],
  ['Love Last Until The World Touches Your Heart', 'd7dd7af5-d345-49ea-b844-3d1b315415a4'],
  ['Scars From Another Dimension', '1148eb7e-5287-4bf3-b01d-d912b24f5adb']
].map(([title, id]) => ({ title, id, audio: `https://cdn1.suno.ai/${id}.mp3`, page: `https://suno.com/song/${id}` }));

const savedNumber = (key, fallback) => {
  const saved = localStorage.getItem(key);
  if (saved == null) return fallback;
  const value = Number(saved);
  return Number.isFinite(value) ? value : fallback;
};

export default function MusicPlayer() {
  const audioRef = useRef(null);
  const [trackIndex, setTrackIndex] = useState(() => Math.min(tracks.length - 1, Math.max(0, savedNumber('srp_music_v1_track', 0))));
  const [volume, setVolume] = useState(() => Math.min(.3, Math.max(0, savedNumber('srp_music_v1_volume', .12))));
  const [enabled, setEnabled] = useState(() => localStorage.getItem('srp_music_v1_enabled') !== 'false');
  const [playing, setPlaying] = useState(false);
  const [waitingForGesture, setWaitingForGesture] = useState(false);
  const track = tracks[trackIndex];

  const start = useCallback(() => {
    if (!enabled || !audioRef.current) return;
    audioRef.current.volume = volume;
    audioRef.current.play().then(() => setWaitingForGesture(false)).catch(() => setWaitingForGesture(true));
  }, [enabled, volume]);

  useEffect(() => {
    localStorage.setItem('srp_music_v1_track', String(trackIndex));
    if (enabled) start();
  }, [trackIndex, enabled, start]);

  useEffect(() => {
    localStorage.setItem('srp_music_v1_volume', String(volume));
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('srp_music_v1_enabled', String(enabled));
    if (!enabled && audioRef.current) audioRef.current.pause();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || playing) return;
    const unlock = () => start();
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [enabled, playing, start, trackIndex]);

  const changeTrack = direction => {
    setEnabled(true);
    setTrackIndex(current => (current + direction + tracks.length) % tracks.length);
  };

  const togglePlayback = () => {
    if (playing) {
      audioRef.current?.pause();
      setEnabled(false);
    } else {
      setEnabled(true);
      if (audioRef.current) {
        audioRef.current.volume = volume;
        audioRef.current.play().then(() => setWaitingForGesture(false)).catch(() => setWaitingForGesture(true));
      }
    }
  };

  return <section className={`shadow-radio ${playing ? 'playing' : ''}`} aria-label="Shadow Radio music player">
    <audio
      ref={audioRef}
      src={track.audio}
      preload="metadata"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => changeTrack(1)}
    />
    <div className="radio-art"><Music2/></div>
    <div className="radio-copy">
      <span>SHADOW RADIO · PLAYA ON SUNO</span>
      <a href={track.page} target="_blank" rel="noreferrer" title={track.title}>{track.title}</a>
      <small>{waitingForGesture ? 'Click anywhere to start at low volume' : `${Math.round(volume * 100)}% volume · ${trackIndex + 1}/${tracks.length}`}</small>
    </div>
    <div className="radio-controls">
      <button onClick={() => changeTrack(-1)} aria-label="Previous song"><SkipBack/></button>
      <button className="radio-play" onClick={togglePlayback} aria-label={playing ? 'Pause music' : 'Play music'}>{playing ? <Pause/> : <Play/>}</button>
      <button onClick={() => changeTrack(1)} aria-label="Next song"><SkipForward/></button>
    </div>
    <label className="radio-volume" title={`Music volume ${Math.round(volume * 100)} percent`}>
      {volume ? <Volume2/> : <VolumeX/>}
      <input type="range" min="0" max="0.3" step="0.01" value={volume} onChange={event => setVolume(Number(event.target.value))}/>
    </label>
    <a className="radio-profile" href={PROFILE_URL} target="_blank" rel="noreferrer" aria-label="Open Playa on Suno"><ExternalLink/></a>
  </section>;
}
