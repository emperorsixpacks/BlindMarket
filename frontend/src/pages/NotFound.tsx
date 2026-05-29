import { Link } from 'react-router-dom';
import { Button } from '../components/bb';

export default function NotFound() {
  return (
    <div className="text-center py-20">
      <h1 className="text-6xl font-bold text-ink-3 mb-4">404</h1>
      <p className="text-lg text-ink-2 mb-8">Page not found</p>
      <Link to="/">
        <Button variant="primary" label="Go home" />
      </Link>
    </div>
  );
}
