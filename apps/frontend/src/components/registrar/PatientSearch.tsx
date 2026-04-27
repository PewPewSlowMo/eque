import { useState, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { toast } from 'sonner';

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  phone?: string | null;
  iin?: string | null;
}

interface PatientSearchProps {
  onSelect: (patient: Patient | null) => void;
  selected: Patient | null;
}

export function PatientSearch({ onSelect, selected }: PatientSearchProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newPatient, setNewPatient] = useState({
    lastName: '', firstName: '', middleName: '', phone: '', iin: '',
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [] } = trpc.patients.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 1 },
  );

  const createMutation = trpc.patients.create.useMutation({
    onSuccess: (patient: Patient) => {
      onSelect(patient);
      setCreateOpen(false);
      setNewPatient({ lastName: '', firstName: '', middleName: '', phone: '', iin: '' });
      toast.success('Пациент создан');
    },
    onError: (e: any) => toast.error(e.message),
  });

  function openCreate() {
    const parts = query.trim().split(/\s+/);
    setNewPatient({
      lastName:   parts[0] ?? '',
      firstName:  parts[1] ?? '',
      middleName: parts[2] ?? '',
      phone: '', iin: '',
    });
    setOpen(false);
    setCreateOpen(true);
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between px-3 py-1.5 border rounded-md bg-secondary/30">
        <div>
          <p className="font-medium text-[10px]">
            {selected.lastName} {selected.firstName} {selected.middleName ?? ''}
          </p>
          {selected.phone && <p className="text-[9px] text-muted-foreground">{selected.phone}</p>}
        </div>
        <button className="text-[9px] text-muted-foreground hover:text-foreground ml-2" onClick={() => onSelect(null)}>
          Изменить
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          placeholder="Поиск пациента по ФИО, ИИН, телефону..."
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="pl-8 pr-3 py-1.5 text-[10px] border border-border rounded outline-none focus:border-primary transition-colors bg-white"
          style={{ width: '260px' }}
        />
      </div>

      {open && debouncedQuery.length >= 1 && (
        <div className="absolute top-full left-0 mt-1 z-50 border border-border rounded-md bg-white shadow-lg overflow-hidden"
          style={{ width: '300px', maxHeight: '220px', overflowY: 'auto' }}>
          {(results as Patient[]).length === 0 ? (
            <div className="px-3 py-2.5 flex flex-col gap-1.5">
              <span className="text-[9px] text-muted-foreground">Пациент не найден</span>
              <button
                onMouseDown={e => { e.preventDefault(); openCreate(); }}
                className="text-left text-[9px] font-semibold text-primary hover:underline">
                + Создать пациента{query.trim() ? ` «${query.trim()}»` : ''}
              </button>
            </div>
          ) : (
            (results as Patient[]).map(p => (
              <button
                key={p.id}
                onMouseDown={e => { e.preventDefault(); onSelect(p); setOpen(false); setQuery(''); }}
                className="w-full text-left px-3 py-2 hover:bg-primary/5 transition-colors border-b border-border/40 last:border-0">
                <div className="text-[10px] font-semibold text-foreground">
                  {p.lastName} {p.firstName} {p.middleName ?? ''}
                </div>
                {(p.phone || p.iin) && (
                  <div className="text-[8px] text-muted-foreground mt-0.5">
                    {p.iin && <span>{p.iin}</span>}
                    {p.iin && p.phone && <span className="mx-1">·</span>}
                    {p.phone && <span>{p.phone}</span>}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый пациент</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Фамилия *</Label>
                <Input value={newPatient.lastName}
                  onChange={e => setNewPatient(p => ({ ...p, lastName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Имя *</Label>
                <Input value={newPatient.firstName}
                  onChange={e => setNewPatient(p => ({ ...p, firstName: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Отчество</Label>
              <Input value={newPatient.middleName}
                onChange={e => setNewPatient(p => ({ ...p, middleName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Телефон</Label>
                <Input value={newPatient.phone}
                  onChange={e => setNewPatient(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>ИИН</Label>
                <Input value={newPatient.iin}
                  onChange={e => setNewPatient(p => ({ ...p, iin: e.target.value }))} />
              </div>
            </div>
            <Button
              className="w-full"
              disabled={!newPatient.lastName || !newPatient.firstName || createMutation.isPending}
              onClick={() => createMutation.mutate({
                lastName: newPatient.lastName,
                firstName: newPatient.firstName,
                middleName: newPatient.middleName || undefined,
                phone: newPatient.phone || undefined,
                iin: newPatient.iin || undefined,
              })}
            >
              {createMutation.isPending ? 'Создание...' : 'Создать'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
