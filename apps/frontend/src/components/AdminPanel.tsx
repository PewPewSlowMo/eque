import { useUser } from '@/contexts/UserContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { UsersTab } from './admin/UsersTab';
import { CabinetsTab } from './admin/CabinetsTab';
import { CategoriesTab } from './admin/CategoriesTab';
import { StatsTab } from './admin/StatsTab';
import { SchedulesTab } from './admin/SchedulesTab';

export function AdminPanel() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-4">
      <Tabs defaultValue={isAdmin ? 'users' : 'schedules'}>
        <TabsList>
          {isAdmin && <TabsTrigger value="users">Пользователи</TabsTrigger>}
          <TabsTrigger value="schedules">Графики</TabsTrigger>
          <TabsTrigger value="cabinets">Кабинеты</TabsTrigger>
          <TabsTrigger value="categories">Категории</TabsTrigger>
          <TabsTrigger value="stats">Статистика</TabsTrigger>
        </TabsList>

        {isAdmin && (
          <TabsContent value="users" className="pt-4">
            <UsersTab />
          </TabsContent>
        )}

        <TabsContent value="schedules" className="pt-4">
          <SchedulesTab />
        </TabsContent>

        <TabsContent value="cabinets" className="pt-4">
          <CabinetsTab />
        </TabsContent>

        <TabsContent value="categories" className="pt-4">
          <CategoriesTab />
        </TabsContent>

        <TabsContent value="stats" className="pt-4">
          <StatsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
