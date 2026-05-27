import { useState, useEffect, useCallback } from 'react';
import { trpc } from '@/lib/trpc';

type Screen = 'welcome' | 'entry' | 'consent' | 'confirm';
type ActiveField = 'lastName' | 'firstName' | 'middleName';
interface Fields { lastName: string; firstName: string; middleName: string; }

const KZ_ROW  = ['Ә','Ғ','Қ','Ң','Ө','Ұ','Ү','Һ','І'];
const ROW1    = ['Й','Ц','У','К','Е','Н','Г','Ш','Щ','З','Х','Ъ'];
const ROW2    = ['Ф','Ы','В','А','П','Р','О','Л','Д','Ж','Э'];
const ROW3    = ['Я','Ч','С','М','И','Т','Ь','Б','Ю','–'];

const GR = 'linear-gradient(135deg,#00685B,#004d44)';
const s = (obj: React.CSSProperties): React.CSSProperties => obj;

function KioskKeyboard({ onKey, onBackspace, onClear, onNext, loading }: {
  onKey: (c: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onNext: () => void;
  loading?: boolean;
}) {
  const keyStyle = s({
    flex: 1, display:'flex', alignItems:'center', justifyContent:'center',
    fontWeight:700, color:'white', cursor:'pointer', userSelect:'none',
    borderRadius:'clamp(3px,0.6vmin,7px)',
    height:'clamp(34px,5.5vh,52px)', minWidth:0,
    fontSize:'clamp(13px,2vmin,20px)',
    background:'rgba(255,255,255,.16)', border:'1px solid rgba(255,255,255,.22)',
    transition:'background .1s, transform .08s',
  });

  const rowStyle = s({ display:'flex', gap:'clamp(2px,0.4vw,5px)' });

  return (
    <div style={{ width:'100%', maxWidth:'min(820px,98vw)',
      background:'rgba(0,0,0,.27)', borderRadius:'clamp(7px,1.2vmin,13px)',
      padding:'clamp(6px,1vmin,10px) clamp(4px,0.7vw,8px)',
      display:'flex', flexDirection:'column', gap:'clamp(4px,0.65vh,7px)' }}>

      <div style={{ textAlign:'center', fontSize:'clamp(8px,1vmin,11px)',
        color:'rgba(179,145,104,.72)', letterSpacing:'1.5px', textTransform:'uppercase',
        marginBottom:'-2px' }}>
        Қазақ әріптері
      </div>

      {/* Kazakh row */}
      <div style={rowStyle}>
        {KZ_ROW.map(c => (
          <button key={c} onClick={() => onKey(c)} style={s({
            ...keyStyle,
            background:'rgba(179,145,104,.26)', border:'1px solid rgba(179,145,104,.48)',
            fontSize:'clamp(14px,2.2vmin,21px)',
          })}>
            {c}
          </button>
        ))}
      </div>

      {/* Row 1 */}
      <div style={rowStyle}>
        {ROW1.map(c => <button key={c} onClick={() => onKey(c)} style={keyStyle}>{c}</button>)}
      </div>

      {/* Row 2 */}
      <div style={rowStyle}>
        {ROW2.map(c => <button key={c} onClick={() => onKey(c)} style={keyStyle}>{c}</button>)}
      </div>

      {/* Row 3 + backspace */}
      <div style={rowStyle}>
        {ROW3.map(c => <button key={c} onClick={() => onKey(c)} style={keyStyle}>{c}</button>)}
        <button onClick={onBackspace} style={s({ ...keyStyle, flex:'1.6',
          background:'rgba(255,255,255,.1)', fontSize:'clamp(16px,2.4vmin,24px)' })}>
          ⌫
        </button>
      </div>

      {/* Bottom row */}
      <div style={rowStyle}>
        <button onClick={onClear} style={s({ ...keyStyle, flex:'2.4',
          fontSize:'clamp(10px,1.4vmin,14px)', lineHeight:1.25, textAlign:'center' })}>
          Тазалау / Очистить
        </button>
        <button onClick={() => onKey(' ')} style={s({ ...keyStyle, flex:5,
          fontSize:'clamp(10px,1.4vmin,14px)' })}>
          БОС ОРЫН / ПРОБЕЛ
        </button>
        <button onClick={onNext} disabled={loading} style={s({ ...keyStyle, flex:'3.2',
          background: loading ? 'rgba(179,145,104,.5)' : '#B39168',
          border:'1px solid #a07d54', fontSize:'clamp(11px,1.6vmin,16px)',
          lineHeight:1.25, textAlign:'center', cursor: loading ? 'not-allowed' : 'pointer' })}>
          ✓ Келесі / Далее
        </button>
      </div>
    </div>
  );
}

export function KioskPage({ slug }: { slug: string }) {
  const [screen, setScreen]           = useState<Screen>('welcome');
  const [fields, setFields]           = useState<Fields>({ lastName:'', firstName:'', middleName:'' });
  const [activeField, setActiveField] = useState<ActiveField>('lastName');
  const [queueNumber, setQueueNumber] = useState(0);
  const [countdown, setCountdown]     = useState(8);
  const [errors, setErrors]           = useState<Partial<Record<ActiveField, boolean>>>({});

  const { data: config, isLoading, error } = trpc.kiosk.getConfig.useQuery(
    { slug },
    { refetchInterval: 30_000 },
  );
  const addMutation = trpc.kiosk.addToQueue.useMutation();

  const handleConsent = useCallback(async (consent: boolean) => {
    if (!fields.lastName.trim() || !fields.firstName.trim()) return;
    try {
      const res = await addMutation.mutateAsync({
        slug,
        lastName:       fields.lastName.trim(),
        firstName:      fields.firstName.trim(),
        middleName:     fields.middleName.trim() || undefined,
        displayConsent: consent,
      });
      setQueueNumber(res.queueNumber);
      setScreen('confirm');
    } catch {
      // error shown via addMutation.error
    }
  }, [fields, slug, addMutation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown and auto-reset on confirm screen
  useEffect(() => {
    if (screen !== 'confirm') return;
    setCountdown(8);
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(id);
          reset();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    setScreen('welcome');
    setFields({ lastName:'', firstName:'', middleName:'' });
    setActiveField('lastName');
    setErrors({});
    addMutation.reset();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKey = useCallback((char: string) => {
    setFields(p => ({ ...p, [activeField]: p[activeField] + char }));
    setErrors(p => ({ ...p, [activeField]: false }));
  }, [activeField]);

  const handleBackspace = useCallback(() => {
    setFields(p => ({ ...p, [activeField]: p[activeField].slice(0, -1) }));
  }, [activeField]);

  const handleClear = useCallback(() => {
    setFields(p => ({ ...p, [activeField]: '' }));
  }, [activeField]);

  const handleNext = useCallback(() => {
    if (activeField === 'lastName') {
      if (!fields.lastName.trim()) { setErrors(p => ({ ...p, lastName: true })); return; }
      setActiveField('firstName');
      return;
    }
    if (activeField === 'firstName') {
      if (!fields.firstName.trim()) { setErrors(p => ({ ...p, firstName: true })); return; }
      setActiveField('middleName');
      return;
    }
    // middleName — переход к экрану согласия
    if (!fields.lastName.trim())  { setErrors(p => ({ ...p, lastName: true }));  setActiveField('lastName');  return; }
    if (!fields.firstName.trim()) { setErrors(p => ({ ...p, firstName: true })); setActiveField('firstName'); return; }
    setScreen('consent');
  }, [activeField, fields]);

  const baseStyle = s({
    background: GR, width:'100%', height:'100%', overflow:'hidden',
    display:'flex', flexDirection:'column', alignItems:'center',
    fontFamily:"'Segoe UI',system-ui,sans-serif",
  });

  const Logo = () => (
    <img src="/logo.png" alt="Логотип" style={{ height:'clamp(40px,6vmin,72px)', width:'auto', flexShrink:0 }} />
  );

  // Loading
  if (isLoading) return (
    <div style={{ ...baseStyle, justifyContent:'center', color:'rgba(255,255,255,.6)',
      fontSize:'clamp(14px,2vmin,20px)' }}>
      Жүктелуде... / Загрузка...
    </div>
  );

  // Error / not found
  if (error || !config) return (
    <div style={{ ...baseStyle, justifyContent:'center', gap:'clamp(8px,1.5vh,16px)' }}>
      <div style={{ color:'white', fontSize:'clamp(20px,3.5vmin,40px)', fontWeight:800 }}>
        Киоск баптанбаған
      </div>
      <div style={{ color:'rgba(255,255,255,.6)', fontSize:'clamp(14px,2.2vmin,24px)' }}>
        Киоск не настроен
      </div>
    </div>
  );

  // Inactive
  if (!config.active) return (
    <div style={{ ...baseStyle, justifyContent:'center', gap:'clamp(8px,1.5vh,16px)' }}>
      <div style={{ color:'white', fontSize:'clamp(20px,3.5vmin,40px)', fontWeight:800 }}>
        Уақытша жұмыс істемейді
      </div>
      <div style={{ color:'rgba(255,255,255,.6)', fontSize:'clamp(14px,2.2vmin,24px)' }}>
        Киоск временно недоступен
      </div>
    </div>
  );

  // Limit exhausted
  if (config.spotsLeft === 0) return (
    <div style={{ ...baseStyle, justifyContent:'center', gap:'clamp(8px,1.5vh,16px)',
      padding:'clamp(20px,4vw,60px)' }}>
      <Logo />
      <div style={{ color:'white', fontSize:'clamp(20px,3.5vmin,40px)', fontWeight:800,
        textAlign:'center', lineHeight:1.2 }}>
        Жазылу жабық
      </div>
      <div style={{ color:'rgba(255,255,255,.6)', fontSize:'clamp(14px,2.2vmin,24px)',
        textAlign:'center' }}>
        Запись закрыта
      </div>
      <div style={{ color:'rgba(255,255,255,.4)', fontSize:'clamp(12px,1.8vmin,20px)',
        textAlign:'center', marginTop:'8px', lineHeight:1.5 }}>
        Бүгінгі лимит таусылды<br/>
        Дневной лимит записей исчерпан
      </div>
    </div>
  );

  // ── Screen: Welcome ──────────────────────────────────────────────────────
  if (screen === 'welcome') return (
    <div style={{ ...baseStyle, justifyContent:'space-evenly',
      padding:'clamp(20px,4vh,60px) clamp(20px,4vw,60px)' }}>
      <Logo />
      <div style={{ color:'white', fontSize:'clamp(24px,5vmin,60px)', fontWeight:800,
        lineHeight:1.15, textAlign:'center' }}>
        {config.name}
      </div>
      <button onClick={() => setScreen('entry')} style={s({
        background:'#B39168', border:'2px solid #a07d54',
        borderRadius:'clamp(10px,1.5vmin,18px)', color:'white', fontWeight:800, cursor:'pointer',
        padding:'clamp(16px,3vh,36px) clamp(40px,8vw,100px)',
        fontSize:'clamp(20px,3.5vmin,42px)', lineHeight:1.3,
      })}>
        Кезекке тұру<br/>
        <span style={{ fontWeight:400, fontSize:'.7em', opacity:.8 }}>Встать в очередь</span>
      </button>
      <div style={{ color:'rgba(255,255,255,.5)', fontSize:'clamp(12px,1.8vmin,20px)' }}>
        {config.waitingCount > 0
          ? `Қазір ${config.waitingCount} адам күтуде / Сейчас ожидают ${config.waitingCount} чел.`
          : 'Кезек бос / Очередь свободна'}
      </div>
      {config.spotsLeft != null && config.spotsLeft > 0 && (
        <div style={{ color:'#B39168', fontSize:'clamp(11px,1.7vmin,18px)', textAlign:'center' }}>
          Қалған орын: {config.spotsLeft} / Осталось мест: {config.spotsLeft}
        </div>
      )}
    </div>
  );

  // ── Screen: Name Entry ───────────────────────────────────────────────────
  if (screen === 'entry') {
    const fieldDefs: { key: ActiveField; kz: string; ru: string }[] = [
      { key:'lastName',   kz:'Тегі',         ru:'Фамилия' },
      { key:'firstName',  kz:'Аты',          ru:'Имя' },
      { key:'middleName', kz:'Әкесінің аты', ru:'Отчество' },
    ];
    return (
      <div style={{ ...baseStyle, justifyContent:'space-between',
        padding:'clamp(8px,1.6vh,20px) clamp(8px,1.5vw,24px)' }}>
        <Logo />
        <div style={{ textAlign:'center', flexShrink:0 }}>
          <div style={{ color:'white', fontSize:'clamp(14px,2.4vmin,22px)', fontWeight:700 }}>
            Деректеріңізді енгізіңіз
          </div>
          <div style={{ color:'rgba(255,255,255,.55)', fontSize:'clamp(11px,1.7vmin,16px)', marginTop:'2px' }}>
            Введите ваши данные
          </div>
        </div>
        <div style={{ width:'100%', maxWidth:'min(820px,98vw)',
          display:'flex', flexDirection:'column', gap:'clamp(4px,0.8vh,9px)' }}>
          {fieldDefs.map(f => (
            <div key={f.key} onClick={() => setActiveField(f.key)} style={s({
              display:'flex', alignItems:'center', gap:'clamp(7px,1.3vw,14px)',
              background: activeField === f.key ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.12)',
              border: `2.5px solid ${errors[f.key] ? '#ef4444' : activeField === f.key ? '#B39168' : 'rgba(255,255,255,.25)'}`,
              borderRadius:'clamp(5px,0.9vmin,9px)',
              padding:'clamp(6px,1.1vh,12px) clamp(9px,1.7vw,16px)', cursor:'pointer',
            })}>
              <div style={{ width:'clamp(110px,19vw,170px)', flexShrink:0 }}>
                <span style={{ color:'rgba(255,255,255,.92)', fontSize:'clamp(11px,1.6vmin,17px)',
                  fontWeight:700, display:'block' }}>{f.kz}</span>
                <span style={{ color:'rgba(255,255,255,.38)', fontSize:'clamp(9px,1.2vmin,13px)',
                  display:'block', marginTop:'2px' }}>{f.ru}</span>
              </div>
              <div style={{ flex:1, color:'white', fontSize:'clamp(14px,2.2vmin,22px)', fontWeight:700 }}>
                {fields[f.key] ? (
                  <>
                    {fields[f.key]}
                    {activeField === f.key && (
                      <span style={{ display:'inline-block', width:'3px',
                        height:'clamp(13px,2vmin,20px)', background:'#B39168', marginLeft:'3px',
                        verticalAlign:'middle', animation:'blink 1s step-end infinite' }} />
                    )}
                  </>
                ) : (
                  <span style={{ fontWeight:400 }}>
                    {activeField === f.key
                      ? <span style={{ display:'inline-block', width:'3px',
                          height:'clamp(13px,2vmin,20px)', background:'#B39168',
                          verticalAlign:'middle', animation:'blink 1s step-end infinite' }} />
                      : <><span style={{ color:'rgba(255,255,255,.4)', display:'block',
                            fontSize:'clamp(11px,1.6vmin,16px)' }}>
                            Енгізу үшін басыңыз...
                          </span>
                          <span style={{ color:'rgba(255,255,255,.22)', display:'block',
                            fontSize:'clamp(9px,1.2vmin,13px)' }}>
                            Нажмите для ввода...
                          </span>
                        </>
                    }
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        {addMutation.error && (
          <div style={{ color:'#fca5a5', fontSize:'clamp(11px,1.6vmin,16px)', flexShrink:0 }}>
            {addMutation.error.message}
          </div>
        )}
        <KioskKeyboard
          onKey={handleKey}
          onBackspace={handleBackspace}
          onClear={handleClear}
          onNext={handleNext}
          loading={addMutation.isPending}
        />
        <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
      </div>
    );
  }

  // ── Screen: Consent ─────────────────────────────────────────────────────
  if (screen === 'consent') {
    const previewName = `${fields.firstName} ${fields.lastName.slice(0, 2)}.`;
    return (
      <div style={{ ...baseStyle, justifyContent: 'space-evenly',
        padding: 'clamp(20px,4vh,60px) clamp(20px,4vw,60px)' }}>
        <Logo />

        {/* Name confirmation card */}
        <div style={{
          background: 'rgba(255,255,255,.13)', border: '2px solid rgba(255,255,255,.3)',
          borderRadius: 'clamp(12px,2vmin,24px)',
          padding: 'clamp(16px,3vh,32px) clamp(24px,6vw,64px)',
          textAlign: 'center', width: '100%', maxWidth: 'min(820px,98vw)',
        }}>
          <div style={{ color: 'rgba(255,255,255,.5)',
            fontSize: 'clamp(12px,1.8vmin,18px)', marginBottom: 6 }}>
            Сіздің деректеріңіз / Ваши данные
          </div>
          <div style={{ color: 'white', fontSize: 'clamp(22px,4vmin,40px)', fontWeight: 800 }}>
            {fields.lastName} {fields.firstName}
          </div>
          {fields.middleName && (
            <div style={{ color: 'rgba(255,255,255,.5)',
              fontSize: 'clamp(14px,2vmin,22px)', marginTop: 4 }}>
              {fields.middleName}
            </div>
          )}
        </div>

        {/* Question */}
        <div style={{ textAlign: 'center', maxWidth: 'min(820px,98vw)', width: '100%' }}>
          <div style={{ color: 'white', fontSize: 'clamp(16px,2.6vmin,28px)',
            fontWeight: 700, lineHeight: 1.3 }}>
            Атыңызды ақпараттық тақтада көрсетуге рұқсат бересіз бе?
          </div>
          <div style={{ color: 'rgba(255,255,255,.55)',
            fontSize: 'clamp(13px,2vmin,22px)', marginTop: 8, lineHeight: 1.35 }}>
            Разрешаете отображать ваше имя на информационном табло?
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column',
          gap: 'clamp(8px,1.5vh,16px)', width: '100%', maxWidth: 'min(820px,98vw)' }}>

          {addMutation.error && (
            <div style={{ color: '#fca5a5',
              fontSize: 'clamp(11px,1.6vmin,16px)', textAlign: 'center' }}>
              {addMutation.error.message}
            </div>
          )}

          <button
            disabled={addMutation.isPending}
            onClick={() => handleConsent(true)}
            style={s({
              background: addMutation.isPending ? 'rgba(179,145,104,.5)' : '#B39168',
              border: '2px solid #a07d54',
              borderRadius: 'clamp(10px,1.5vmin,18px)',
              color: 'white', fontWeight: 800,
              cursor: addMutation.isPending ? 'not-allowed' : 'pointer',
              padding: 'clamp(14px,2.5vh,28px) clamp(20px,4vw,48px)',
              fontSize: 'clamp(18px,3vmin,32px)', lineHeight: 1.3, width: '100%',
            })}>
            ✓ Иә, келісемін / Да
            <div style={{ fontWeight: 400, fontSize: '.65em', opacity: .75, marginTop: 4 }}>
              На табло: «{previewName}»
            </div>
          </button>

          <button
            disabled={addMutation.isPending}
            onClick={() => handleConsent(false)}
            style={s({
              background: 'rgba(255,255,255,.1)',
              border: '2px solid rgba(255,255,255,.2)',
              borderRadius: 'clamp(10px,1.5vmin,18px)',
              color: 'white', fontWeight: 800,
              cursor: addMutation.isPending ? 'not-allowed' : 'pointer',
              padding: 'clamp(14px,2.5vh,28px) clamp(20px,4vw,48px)',
              fontSize: 'clamp(18px,3vmin,32px)', lineHeight: 1.3, width: '100%',
            })}>
            ✗ Жоқ / Нет
            <div style={{ fontWeight: 400, fontSize: '.65em', opacity: .65, marginTop: 4 }}>
              На табло: только порядковый номер
            </div>
          </button>
        </div>

        {/* Back button */}
        <button
          onClick={() => { setScreen('entry'); addMutation.reset(); }}
          style={s({
            background: 'none', border: 'none',
            color: 'rgba(255,255,255,.4)',
            fontSize: 'clamp(12px,1.8vmin,18px)', cursor: 'pointer',
          })}>
          ← Артқа / Назад
        </button>
      </div>
    );
  }

  // ── Screen: Confirm ──────────────────────────────────────────────────────
  return (
    <div style={{ ...baseStyle, justifyContent:'center',
      gap:'clamp(16px,3vh,40px)', padding:'clamp(20px,4vw,60px)' }}>
      <Logo />
      <div style={{ background:'rgba(255,255,255,.13)', border:'2px solid rgba(255,255,255,.3)',
        borderRadius:'clamp(12px,2vmin,24px)',
        padding:'clamp(24px,5vh,64px) clamp(32px,8vw,96px)', textAlign:'center' }}>
        <div style={{ color:'rgba(255,255,255,.7)', fontSize:'clamp(14px,2.2vmin,24px)',
          marginBottom:'8px' }}>
          Сіздің нөміріңіз / Ваш номер
        </div>
        <div style={{ color:'white', fontSize:'clamp(60px,14vmin,160px)',
          fontWeight:900, lineHeight:1 }}>
          №{queueNumber}
        </div>
        <div style={{ color:'#B39168', fontSize:'clamp(18px,3.2vmin,36px)',
          fontWeight:800, marginTop:'16px' }}>
          Кезекке тұрдыңыз!
        </div>
        <div style={{ color:'rgba(255,255,255,.7)', fontSize:'clamp(14px,2.2vmin,24px)',
          marginTop:'4px' }}>
          Вы в очереди!
        </div>
        <div style={{ color:'rgba(255,255,255,.5)', fontSize:'clamp(12px,1.8vmin,20px)',
          marginTop:'16px' }}>
          Шақыруды күтіңіз / Ожидайте вызова
        </div>
      </div>
      <div style={{ color:'rgba(255,255,255,.4)', fontSize:'clamp(12px,1.7vmin,18px)' }}>
        {countdown} сек.
      </div>
    </div>
  );
}
