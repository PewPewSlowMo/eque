import { useUser } from '@/contexts/UserContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { UsersTab } from './admin/UsersTab';
import { CabinetsTab } from './admin/CabinetsTab';
import { CategoriesTab } from './admin/CategoriesTab';
import { StatsTab } from './admin/StatsTab';
import { ScheduleTab } from './admin/ScheduleTab';
import { DepartmentsTab } from './admin/DepartmentsTab';
import { BoardsTab } from './admin/BoardsTab';
import { ServicesTab } from './admin/ServicesTab';

export function AdminPanel() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';
  const isDeptHead = user?.role === 'DEPARTMENT_HEAD';

  return (
    <div className="h-full overflow-y-auto p-4">
      <Tabs defaultValue={isAdmin ? 'users' : 'schedules'}>
        <TabsList>
          {isAdmin && <TabsTrigger value="users">Пользователи</TabsTrigger>}
          {isAdmin && <TabsTrigger value="departments">Отделения</TabsTrigger>}
          <TabsTrigger value="schedules">Графики</TabsTrigger>
          <TabsTrigger value="cabinets">Кабинеты</TabsTrigger>
          <TabsTrigger value="categories">Категории</TabsTrigger>
          <TabsTrigger value="stats">Статистика</TabsTrigger>
          {(isAdmin || isDeptHead) && <TabsTrigger value="services">Услуги</TabsTrigger>}
          {isAdmin && <TabsTrigger value="boards">Табло</TabsTrigger>}
        </TabsList>

        {isAdmin && (
          <TabsContent value="users" className="pt-4">
            <UsersTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="departments" className="pt-4">
            <DepartmentsTab />
          </TabsContent>
        )}

        <TabsContent value="schedules" className="pt-4">
          <ScheduleTab />
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

        {(isAdmin || isDeptHead) && (
          <TabsContent value="services" className="pt-4">
            <ServicesTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="boards" className="pt-4">
            <BoardsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
