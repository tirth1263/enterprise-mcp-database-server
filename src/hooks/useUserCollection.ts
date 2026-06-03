import { useEffect, useMemo, useState } from "react";
import {
  collection,
  type DocumentData,
  onSnapshot,
  orderBy,
  query,
  type QueryDocumentSnapshot
} from "firebase/firestore";
import { db } from "../firebase";

export type CollectionState<T> = {
  data: T[];
  loading: boolean;
  error: string;
};

export function useUserCollection<T extends { id: string }>(
  userId: string | undefined,
  collectionName: string
): CollectionState<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState("");

  const collectionRef = useMemo(() => {
    if (!userId) return null;
    return collection(db, "users", userId, collectionName);
  }, [collectionName, userId]);

  useEffect(() => {
    if (!collectionRef) {
      setData([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      query(collectionRef, orderBy("createdAt", "desc")),
      (snapshot) => {
        setData(snapshot.docs.map((docSnapshot) => mapDoc<T>(docSnapshot)));
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [collectionRef]);

  return { data, loading, error };
}

function mapDoc<T extends { id: string }>(docSnapshot: QueryDocumentSnapshot<DocumentData>): T {
  return {
    id: docSnapshot.id,
    ...docSnapshot.data()
  } as T;
}
