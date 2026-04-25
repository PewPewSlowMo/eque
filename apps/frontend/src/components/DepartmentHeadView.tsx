import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { useQueueSocket } from './registrar/useQueueSocket';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { DoctorQueueCard } from './head/DoctorQueueCard';
import { AssignDoctorDialog } from './head/AssignDoctorDialog';
import { toast } from 'sonner';
import { LayoutGrid, Users } from 'lucide-react';

export function DepartmentHeadView() {
  const { user } = useUser();
  const departmentId = user?.departmentId ?? '';

  useQueueSocket();

  const { data: allAssignments = [] } = trpc.assignments.getActive.useQuery();
  const { data: doctors = [] } = trpc.users.getDoctors.useQuery(
    { departmentId },
    { enabled: !!departmentId },
  );
  const { data: cabinets = [] } = trpc.cabinets.getAll.useQuery();
  const utils = trpc.useUtils();

  const unassign = trpc.assignments.unassign.useMutation({
    onSuccess: () => {
      utils.assignments.getActive.invalidate();
      toast.success('Назначение снято');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deptAssignments = (allAssignments as any[]).filter(
    (a: any) => a.doctor.departmentId === departmentId,
  );

  return (
    <div className="space-y-4">
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue" className="gap-2">
            <LayoutGrid className="h-4 w-4" />
            Очередь
          </TabsTrigger>
          <TabsTrigger value="assignments" className="gap-2">
            <Users className="h-4 w-4" />
            Назначения
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="pt-4">
          {deptAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              Нет активных врачей в отделе
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {deptAssignments.map((a: any) => (
                <DoctorQueueCard key={a.id} assignment={a} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="assignments" className="pt-4">
          <div className="space-y-4">
            <div className="flex justify-end">
              <AssignDoctorDialog
                doctors={doctors as any[]}
                cabinets={cabinets as any[]}
              />
            </div>

            {deptAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Нет активных назначений
              </p>
            ) : (
              <div className="border rounded-lg divide-y">
                {deptAssignments.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="font-medium text-sm">
                        {a.doctor.lastName} {a.doctor.firstName}
                        {a.doctor.specialty && (
                          <span className="ml-1 text-muted-foreground font-normal">
                            · {a.doctor.specialty}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Кабинет {a.cabinet.number}
                        {a.cabinet.name ? ` — ${a.cabinet.name}` : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={unassign.isPending}
                      onClick={() => {
                        if (confirm(`Снять назначение врача ${a.doctor.lastName}?`)) {
                          unassign.mutate({ assignmentId: a.id });
                        }
                      }}
                    >
                      Снять
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
