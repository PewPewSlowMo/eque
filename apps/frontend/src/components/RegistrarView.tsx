import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AddToQueueForm } from './registrar/AddToQueueForm';
import { WaitingList } from './registrar/WaitingList';
import { useQueueSocket } from './registrar/useQueueSocket';
import { ClipboardList, UserPlus } from 'lucide-react';

export function RegistrarView() {
  useQueueSocket();

  return (
    <div className="space-y-4">
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue" className="gap-2">
            <UserPlus className="h-4 w-4" />
            Постановка в очередь
          </TabsTrigger>
          <TabsTrigger value="waiting" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Список ожидания
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="pt-4">
          <AddToQueueForm />
        </TabsContent>

        <TabsContent value="waiting" className="pt-4">
          <WaitingList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
