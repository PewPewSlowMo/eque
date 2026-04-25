import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';

const CATEGORY_LABEL: Record<string, string> = {
  PAID_ONCE: 'Платный (разовый)',
  PAID_CONTRACT: 'Платный (контракт)',
  OSMS: 'ОСМС',
  CONTINGENT: 'Контингент',
  EMPLOYEE: 'Сотрудник',
};

const CATEGORIES = ['PAID_ONCE', 'PAID_CONTRACT', 'OSMS', 'CONTINGENT', 'EMPLOYEE'] as const;

export function CategoriesTab() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  const { data: settings = [], isLoading } = trpc.settings.getCategorySettings.useQuery();
  const utils = trpc.useUtils();

  const updateSetting = trpc.settings.updateCategorySettings.useMutation({
    onSuccess: () => utils.settings.getCategorySettings.invalidate(),
    onError: (e: any) => toast.error(e.message),
  });

  const getVal = (category: string, field: 'requiresArrivalConfirmation' | 'requiresPaymentConfirmation') => {
    const s = (settings as any[]).find((x: any) => x.category === category);
    return s ? s[field] : false;
  };

  const toggle = (
    category: string,
    field: 'requiresArrivalConfirmation' | 'requiresPaymentConfirmation',
    current: boolean,
  ) => {
    const s = (settings as any[]).find((x: any) => x.category === category);
    if (!s) return;
    updateSetting.mutate({
      category: category as any,
      requiresArrivalConfirmation: field === 'requiresArrivalConfirmation' ? !current : s.requiresArrivalConfirmation,
      requiresPaymentConfirmation: field === 'requiresPaymentConfirmation' ? !current : s.requiresPaymentConfirmation,
    });
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Категория</th>
            <th className="text-center px-4 py-2 font-medium">Требует подтверждения прихода</th>
            <th className="text-center px-4 py-2 font-medium">Требует подтверждения оплаты</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {CATEGORIES.map((cat) => (
            <tr key={cat} className="hover:bg-muted/50">
              <td className="px-4 py-3 font-medium">{CATEGORY_LABEL[cat]}</td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  disabled={!isAdmin || updateSetting.isPending}
                  checked={getVal(cat, 'requiresArrivalConfirmation')}
                  onChange={() => toggle(cat, 'requiresArrivalConfirmation', getVal(cat, 'requiresArrivalConfirmation'))}
                  className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                />
              </td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  disabled={!isAdmin || updateSetting.isPending}
                  checked={getVal(cat, 'requiresPaymentConfirmation')}
                  onChange={() => toggle(cat, 'requiresPaymentConfirmation', getVal(cat, 'requiresPaymentConfirmation'))}
                  className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
