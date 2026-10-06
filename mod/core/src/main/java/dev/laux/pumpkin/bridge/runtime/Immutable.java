package dev.laux.pumpkin.bridge.runtime;

import java.util.AbstractList;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.RandomAccess;
import java.util.stream.Collector;

/** Immutable snapshots for the Java 8 production runtime. */
public final class Immutable {
	private Immutable() {
	}

	public static <E> List<E> list() {
		return Collections.emptyList();
	}

	public static <E> List<E> list(E value) {
		return new SnapshotList<>(new Object[] {value}, true);
	}

	@SafeVarargs
	public static <E> List<E> list(E... values) {
		if (values.length == 0) {
			return list();
		}
		Object[] snapshot = new Object[values.length];
		for (int index = 0; index < values.length; index++) {
			snapshot[index] = values[index];
		}
		return new SnapshotList<>(snapshot, true);
	}

	public static <E> List<E> copyList(Collection<E> values) {
		if (values.isEmpty()) {
			return list();
		}
		if (values instanceof SnapshotList && ((SnapshotList<?>) values).nullFree) {
			return (List<E>) values;
		}
		return new SnapshotList<>(values.toArray(), true);
	}

	public static <K, V> Map<K, V> copyMap(Map<? extends K, ? extends V> values) {
		if (values.isEmpty()) {
			return Collections.emptyMap();
		}
		Map<K, V> snapshot = new LinkedHashMap<>(values.size());
		values.forEach((key, value) -> snapshot.put(Objects.requireNonNull(key), Objects.requireNonNull(value)));
		return Collections.unmodifiableMap(snapshot);
	}

	/** Like Stream.toList(), the collected snapshot permits null elements. */
	public static <E> Collector<E, ?, List<E>> toList() {
		return Collector.of(ArrayList<E>::new, List::add, (left, right) -> {
			left.addAll(right);
			return left;
		}, values -> values.isEmpty() ? Immutable.<E>list() : new SnapshotList<E>(values.toArray(), false));
	}

	private static final class SnapshotList<E> extends AbstractList<E> implements RandomAccess {
		private final Object[] values;
		private final boolean nullFree;

		private SnapshotList(Object[] values, boolean rejectNulls) {
			this.values = values;
			boolean noNulls = true;
			for (Object value : values) {
				if (value == null) {
					if (rejectNulls) {
						throw new NullPointerException("null snapshot element");
					}
					noNulls = false;
				}
			}
			nullFree = noNulls;
		}

		@Override
		@SuppressWarnings("unchecked")
		public E get(int index) {
			return (E) values[index];
		}

		@Override
		public int size() {
			return values.length;
		}
	}
}
