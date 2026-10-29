import './AiMotion.css';

export default function AiMotion({ label, detail }) {
  return <div className="ai-motion" role="status" aria-live="polite" aria-label={`${label}. ${detail}`}>
    <span className="ai-motion-orb" aria-hidden="true"><span>AI</span></span>
    <span className="ai-motion-copy"><strong>{label}</strong><span>{detail}</span></span>
  </div>;
}
