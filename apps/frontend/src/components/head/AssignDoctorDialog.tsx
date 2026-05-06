import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';

const selectClass = 'w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface AssignDoctorDialogProps {
  doctors: any[];
  cabinets: any[];
}

export function AssignDoctorDialog({ doctors, cabinets }: AssignDoctorDialogProps) {
  const [open, setOpen] = useState(false);
  const [doctorId, setDoctorId] = useState('');
  const [cabinetId, setCabinetId] = useState('');
  const utils = trpc.useUtils();

  const assign = trpc.assignments.assign.useMutation({
    onSuccess: () => {
      utils.assignments.getActive.invalidate();
      toast.success('Врач назначен');
      setOpen(false);
      setDoctorId('');
      setCabinetId('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <UserPlus className="h-4 w-4" />
          Назначить врача
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Назначить врача в кабинет</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Врач</Label>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className={selectClass}
            >
              <option value="">Выберите врача...</option>
              {doctors.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.lastName} {d.firstName}
                  {d.specialty ? ` — ${d.specialty}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Кабинет</Label>
            <select
              value={cabinetId}
              onChange={(e) => setCabinetId(e.target.value)}
              className={selectClass}
            >
              <option value="">Выберите кабинет...</option>
              {cabinets.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.number}{c.name ? ` — ${c.name}` : ''}
                </option>
              ))}
            </select>
          </div>

          <Button
            className="w-full"
            disabled={!doctorId || !cabinetId || assign.isPending}
            onClick={() => assign.mutate({ doctorId, cabinetId })}
          >
            {assign.isPending ? 'Назначение...' : 'Назначить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
