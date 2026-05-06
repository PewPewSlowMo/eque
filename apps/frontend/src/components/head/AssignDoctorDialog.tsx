import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';

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
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите врача..." />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.lastName} {d.firstName}
                    {d.specialty ? ` — ${d.specialty}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Кабинет</Label>
            <Select value={cabinetId} onValueChange={setCabinetId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите кабинет..." />
              </SelectTrigger>
              <SelectContent>
                {cabinets.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.number}{c.name ? ` — ${c.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
