import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

const CATEGORY_OPTIONS = [
  { value: 'PAID_ONCE',     label: 'Платный (разовый)' },
  { value: 'PAID_CONTRACT', label: 'Платный (контракт)' },
  { value: 'OSMS',          label: 'ОСМС' },
  { value: 'CONTINGENT',    label: 'Контингент' },
  { value: 'EMPLOYEE',      label: 'Сотрудник' },
];

const selectCls = 'w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[а-яёa-z0-9]+/gi, m =>
      m.split('').map(c => {
        const map: Record<string, string> = {
          а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',
          и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',
          с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',
          ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
        };
        return map[c] ?? c;
      }).join('')
    )
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface KioskForm {
  name: string;
  slug: string;
  doctorId: string;
  serviceId: string;
  defaultCategory: string;
  active: boolean;
}

const EMPTY: KioskForm = {
  name:'', slug:'', doctorId:'', serviceId:'',
  defaultCategory:'OSMS', active:true,
};

interface DialogProps {
  open: boolean;
  onClose: () => void;
  editing: any | null;
}

function KioskDialog({ open, onClose, editing }: DialogProps) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<KioskForm>(editing
    ? { name:editing.name, slug:editing.slug, doctorId:editing.doctorId,
        serviceId:editing.serviceId, defaultCategory:editing.defaultCategory,
        active:editing.active }
    : EMPTY
  );

  const { data: doctors = [] } = trpc.users.getDoctors.useQuery(undefined);
  const { data: services = [] } = trpc.services.getForDoctor.useQuery(
    { doctorId: form.doctorId },
    { enabled: !!form.doctorId },
  );

  const create = trpc.kiosk.create.useMutation({
    onSuccess: () => { utils.kiosk.list.invalidate(); toast.success('Киоск создан'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = trpc.kiosk.update.useMutation({
    onSuccess: () => { utils.kiosk.list.invalidate(); toast.success('Киоск обновлён'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (field: keyof KioskForm, value: any) =>
    setForm(p => ({ ...p, [field]: value }));

  const handleNameChange = (name: string) => {
    setForm(p => ({ ...p, name, slug: p.slug || slugify(name) }));
  };

  const handleSubmit = () => {
    if (!form.name.trim())    { toast.error('Укажите название'); return; }
    if (!form.slug.trim())    { toast.error('Укажите slug'); return; }
    if (!/^[a-z0-9-]+$/.test(form.slug)) { toast.error('Slug: только строчные латинские буквы, цифры и дефис'); return; }
    if (!form.doctorId)       { toast.error('Выберите врача'); return; }
    if (!form.serviceId)      { toast.error('Выберите услугу'); return; }

    const data = { ...form, active: form.active };
    if (editing) {
      update.mutate({ id: editing.id, ...data });
    } else {
      create.mutate(data as any);
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Редактировать киоск' : 'Создать киоск'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Название (отображается на экране)</Label>
            <Input value={form.name} onChange={e => handleNameChange(e.target.value)}
              placeholder="Кабинет забора крови / Қан алу кабинеті" />
          </div>
          <div>
            <Label>Slug (URL-идентификатор)</Label>
            <Input value={form.slug}
              onChange={e => set('slug', e.target.value.toLowerCase())}
              placeholder="blood-draw" className="font-mono" />
            <p className="text-xs text-muted-foreground mt-1">
              Ссылка: {window.location.origin}/kiosk/{form.slug || '...'}
            </p>
          </div>
          <div>
            <Label>Врач</Label>
            <select className={selectCls} value={form.doctorId}
              onChange={e => { set('doctorId', e.target.value); set('serviceId', ''); }}>
              <option value="">— выберите врача —</option>
              {(doctors as any[]).map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.lastName} {d.firstName} {d.middleName ?? ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Услуга</Label>
            <select className={selectCls} value={form.serviceId}
              onChange={e => set('serviceId', e.target.value)}
              disabled={!form.doctorId}>
              <option value="">— выберите услугу —</option>
              {(services as any[]).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Категория пациентов по умолчанию</Label>
            <select className={selectCls} value={form.defaultCategory}
              onChange={e => set('defaultCategory', e.target.value)}>
              {CATEGORY_OPTIONS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="kiosk-active" checked={form.active}
              onChange={e => set('active', e.target.checked)} />
            <Label htmlFor="kiosk-active">Активен</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? 'Сохранение...' : (editing ? 'Сохранить' : 'Создать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KioskManager() {
  const utils = trpc.useUtils();
  const { data: kiosks = [], isLoading } = trpc.kiosk.list.useQuery();
  const del = trpc.kiosk.delete.useMutation({
    onSuccess: () => { utils.kiosk.list.invalidate(); toast.success('Киоск удалён'); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggle = trpc.kiosk.update.useMutation({
    onSuccess: () => utils.kiosk.list.invalidate(),
    onError: (e: any) => toast.error(e.message),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/kiosk/${slug}`);
    toast.success('Ссылка скопирована');
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          Создать киоск
        </Button>
      </div>

      {(kiosks as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет киосков</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium">Врач</th>
                <th className="text-left px-4 py-2 font-medium">Услуга</th>
                <th className="text-left px-4 py-2 font-medium">Slug</th>
                <th className="text-left px-4 py-2 font-medium">Статус</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(kiosks as any[]).map((k: any) => (
                <tr key={k.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2 font-medium">{k.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {k.doctor.lastName} {k.doctor.firstName}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{k.service.name}</td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs text-blue-500">/kiosk/{k.slug}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      k.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {k.active ? 'Активен' : 'Неактивен'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <Button size="sm" variant="outline"
                        onClick={() => copyLink(k.slug)}>
                        Копировать ссылку
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => { setEditing(k); setDialogOpen(true); }}>
                        Изменить
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => toggle.mutate({ id: k.id, active: !k.active })}>
                        {k.active ? 'Деактивировать' : 'Активировать'}
                      </Button>
                      <Button size="sm" variant="destructive"
                        onClick={() => { if (confirm(`Удалить киоск "${k.name}"?`)) del.mutate({ id: k.id }); }}>
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <KioskDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          editing={editing}
        />
      )}
    </div>
  );
}
