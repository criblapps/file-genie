import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { InventoryView } from './views/InventoryView';
import { ComparisonView } from './views/ComparisonView';
import { EditView } from './views/EditView';
import { DriftView } from './views/DriftView';
import './App.css';

const basePath = (window as unknown as { CRIBL_BASE_PATH?: string }).CRIBL_BASE_PATH ?? '/';

export default function App() {
  return (
    <BrowserRouter basename={basePath}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<InventoryView />} />
          <Route path="lookup/:name" element={<ComparisonView />} />
          <Route path="lookup/:name/edit" element={<EditView />} />
          <Route path="drift" element={<DriftView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
