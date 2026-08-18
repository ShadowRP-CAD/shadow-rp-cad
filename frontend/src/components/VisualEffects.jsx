import { useEffect, useRef } from 'react';

export default function VisualEffects() {
  const cursorRef = useRef(null);
  const trailRefs = useRef([]);

  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches) return;
    const cursor = cursorRef.current;
    const trails = trailRefs.current;
    const points = trails.map(() => ({ x: -100, y: -100 }));
    let targetX = -100, targetY = -100, frame;
    const move = event => {
      targetX = event.clientX;
      targetY = event.clientY;
      document.documentElement.classList.add('custom-cursor-active');
    };
    const press = () => cursor?.classList.add('pressed');
    const release = () => cursor?.classList.remove('pressed');
    const leave = () => document.documentElement.classList.remove('custom-cursor-active');
    const animate = () => {
      if (cursor) cursor.style.transform = `translate3d(${targetX}px,${targetY}px,0)`;
      let leaderX = targetX, leaderY = targetY;
      points.forEach((point, index) => {
        const ease = .32 - index * .035;
        point.x += (leaderX - point.x) * ease;
        point.y += (leaderY - point.y) * ease;
        trails[index]?.style.setProperty('transform', `translate3d(${point.x}px,${point.y}px,0)`);
        leaderX = point.x;
        leaderY = point.y;
      });
      frame = requestAnimationFrame(animate);
    };
    addEventListener('pointermove', move, { passive: true });
    addEventListener('pointerdown', press, { passive: true });
    addEventListener('pointerup', release, { passive: true });
    document.documentElement.addEventListener('mouseleave', leave);
    animate();
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('pointermove', move);
      removeEventListener('pointerdown', press);
      removeEventListener('pointerup', release);
      document.documentElement.removeEventListener('mouseleave', leave);
      document.documentElement.classList.remove('custom-cursor-active');
    };
  }, []);

  return <>
    <div className="shadow-atmosphere" aria-hidden="true"><i/><i/><i/><div className="aurora-wave"/></div>
    <div className="shadow-cursor" ref={cursorRef} aria-hidden="true"><span/></div>
    <div className="cursor-trail" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} ref={node => { trailRefs.current[index] = node; }}/>)}</div>
  </>;
}

