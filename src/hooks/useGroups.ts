import { useState, useEffect, useCallback } from 'react';
import type { Group } from '../types';

const API = 'http://localhost:3020';

const DEFAULT_GROUP: Group = {
  id: 'default',
  name: 'Default Group',
  agents: ['Claw', 'Deep'],
  createdAt: new Date().toISOString(),
};

export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([DEFAULT_GROUP]);
  const [selectedGroupId, setSelectedGroupId] = useState('default');
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/groups`);
      const data = await res.json();
      const list: Group[] = Array.isArray(data) ? data : (data.groups || []);
      if (list.length > 0) setGroups(list);
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const createGroup = async (name: string, agents: string[], description?: string) => {
    const res = await fetch(`${API}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, agents, description }),
    });
    const data = await res.json();
    await fetchGroups();
    return data;
  };

  const deleteGroup = async (id: string) => {
    await fetch(`${API}/api/groups/${id}`, { method: 'DELETE' });
    if (selectedGroupId === id) setSelectedGroupId('default');
    await fetchGroups();
  };

  const selectedGroup = groups.find(g => g.id === selectedGroupId) || groups[0] || DEFAULT_GROUP;

  return {
    groups,
    selectedGroupId,
    setSelectedGroupId,
    selectedGroup,
    createGroup,
    deleteGroup,
    loading,
    refetch: fetchGroups,
  };
}
