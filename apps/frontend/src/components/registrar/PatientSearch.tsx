import { useState, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UserPlus, Search } from 'lucide-react';
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

  if (selected) {
    return (
      <div className="flex items-center justify-between p-3 border rounded-md bg-secondary/30">
        <div>
          <p className="font-medium text-sm">
            {selected.lastName} {selected.firstName} {selected.middleName ?? ''}
          </p>
          {selected.phone && <p className="text-xs text-muted-foreground">{selected.phone}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>
          Изменить
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Поиск по ФИО, телефону, ИИН..."
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="pl-9"
        />
      </div>

      {open && debouncedQuery.length >= 1 && (
        <div className="border rounded-md bg-background shadow-md max-h-48 overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">Пациенты не найдены</p>
          ) : (
            (results as Patient[]).map((p) => (
              <button
                key={p.id}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => { onSelect(p); setOpen(false); setQuery(''); }}
              >
                <span className="font-medium">{p.lastName} {p.firstName} {p.middleName ?? ''}</span>
                {p.phone && <span className="ml-2 text-muted-foreground">{p.phone}</span>}
              </button>
            ))
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <UserPlus className="h-4 w-4 mr-2" />
            Создать нового пациента
          </Button>
        </DialogTrigger>
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
