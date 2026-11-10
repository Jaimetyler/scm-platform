import WarehouseIntelligence from './warehouse-intelligence';
import report from '@/lib/reporting/warehouse-intelligence-data.json';
export default function Page(){ return <WarehouseIntelligence initialData={report}/>; }
