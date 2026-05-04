interface Props {
  slug: string;
}

export function BoardView({ slug }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d1117', color: 'rgba(255,255,255,.4)', fontSize: 24, fontFamily: 'Montserrat, sans-serif' }}>
      Табло: {slug}
    </div>
  );
}
