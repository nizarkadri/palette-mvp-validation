import { useState } from "react";

const CUSTOM_SWATCH_INTENT_OPTIONS = [
	{ value: "auto", label: "Auto" },
	{ value: "choice", label: "Choice / poll" },
	{ value: "badge", label: "Badge / chip" },
	{ value: "button", label: "Button" },
	{ value: "control", label: "Control" },
	{ value: "surface", label: "Surface" },
	{ value: "icon", label: "Icon" },
	{ value: "text", label: "Text" },
];

const INTENT_LABELS = Object.fromEntries(
	CUSTOM_SWATCH_INTENT_OPTIONS.map((option) => [option.value, option.label]),
);

const BASE_ROLES = [
	{ key: "primary", label: "Primary", color: "#a855f7" },
	{ key: "secondary", label: "Secondary", color: "#3b82f6" },
	{ key: "accent", label: "Accent", color: "#f59e0b" },
	{
		key: "custom",
		label: "Exclude",
		color: "#64748b",
		emptyMessage: "drop elements here to leave their colors unchanged",
	},
];

/**
 * RoleKanban
 * ----------
 * Drag-and-drop role list. Base roles recolor elements with palette colors;
 * Exclude intentionally leaves elements unchanged. User-added swatches create
 * extra custom color roles that can be renamed from their section headers.
 */
export default function RoleKanban({
	elements,
	inventoryItems = [],
	customSwatches = [],
	onChangeRole,
	onAddInventoryElement,
	onRemoveElement,
	onRenameElement,
	onRenameRole,
	onChangeRoleIntent,
	onImproveRoleIntent,
	improvingRoleIntentId = null,
	canImproveRoleIntent = true,
	onToggleTextLock,
	onHover,
	onInventoryHover,
}) {
	const [draggingId, setDraggingId] = useState(null);
	const [dragOverRole, setDragOverRole] = useState(null);
	const [inventoryErrors, setInventoryErrors] = useState({});
	const [activePickerRole, setActivePickerRole] = useState(null);
	const [pickerDirections, setPickerDirections] = useState({});
	const [pickerMaxHeights, setPickerMaxHeights] = useState({});
	const [activeInventoryGroup, setActiveInventoryGroup] = useState(null);
	const [inventorySearch, setInventorySearch] = useState("");
	const [editingId, setEditingId] = useState(null);
	const [editingLabel, setEditingLabel] = useState("");
	const [editingRoleKey, setEditingRoleKey] = useState(null);
	const [editingRoleLabel, setEditingRoleLabel] = useState("");
	const [collapsedRoles, setCollapsedRoles] = useState({});

	const roles = [
		...BASE_ROLES,
		...customSwatches.map((swatch) => ({
			...swatch,
			key: swatch.id,
			label: swatch.label || "Custom",
			color: swatch.color,
			isCustomSwatch: true,
			emptyMessage: "drop elements here to use this swatch color",
		})),
	];

	function startRename(element) {
		setEditingId(element.id);
		setEditingLabel(element.label || element.id);
	}

	function saveRename() {
		if (!editingId) return;
		onRenameElement?.(editingId, editingLabel);
		setEditingId(null);
		setEditingLabel("");
	}

	function cancelRename() {
		setEditingId(null);
		setEditingLabel("");
	}

	function startRoleRename(role) {
		if (!role.isCustomSwatch) return;
		setEditingRoleKey(role.key);
		setEditingRoleLabel(role.label || "Custom");
	}

	function saveRoleRename() {
		if (!editingRoleKey) return;
		onRenameRole?.(editingRoleKey, editingRoleLabel);
		setEditingRoleKey(null);
		setEditingRoleLabel("");
	}

	function cancelRoleRename() {
		setEditingRoleKey(null);
		setEditingRoleLabel("");
	}

	function getPickerPlacement(event) {
		const rect = event.currentTarget.getBoundingClientRect();
		const scrollContainer = event.currentTarget.closest(".panel-pane");
		const containerRect = scrollContainer?.getBoundingClientRect();
		const visibleTop = Math.max(0, containerRect?.top ?? 0);
		const visibleBottom = Math.min(
			window.innerHeight,
			containerRect?.bottom ?? window.innerHeight,
		);
		const margin = 14;
		const availableBelow = Math.max(0, visibleBottom - rect.bottom - margin);
		const availableAbove = Math.max(0, rect.top - visibleTop - margin);
		const desiredHeight = Math.min(
			420,
			Math.max(260, window.innerHeight - 128),
		);
		const direction =
			availableBelow >= desiredHeight || availableBelow >= availableAbove
				? "down"
				: "up";
		const available = direction === "up" ? availableAbove : availableBelow;
		return {
			direction,
			maxHeight: Math.max(220, Math.min(420, available || desiredHeight)),
		};
	}

	function togglePicker(roleKey, event) {
		const { direction, maxHeight } = getPickerPlacement(event);
		setPickerDirections((prev) => ({ ...prev, [roleKey]: direction }));
		setPickerMaxHeights((prev) => ({ ...prev, [roleKey]: maxHeight }));
		setActivePickerRole((current) => (current === roleKey ? null : roleKey));
		setActiveInventoryGroup(null);
		setInventorySearch("");
		setInventoryErrors((prev) => ({ ...prev, [roleKey]: null }));
		onInventoryHover?.(null);
	}

	function handleInventoryAdd(roleKey, item) {
		const result = onAddInventoryElement?.(roleKey, item);
		if (result?.ok === false) {
			setInventoryErrors((prev) => ({ ...prev, [roleKey]: result.error }));
			return;
		}

		setInventoryErrors((prev) => ({ ...prev, [roleKey]: null }));
		onInventoryHover?.(null);
	}

	function getFilteredInventory() {
		const query = inventorySearch.trim().toLowerCase();
		if (!query) return inventoryItems;

		return inventoryItems.filter((item) => {
			return [item.label, item.kind, item.text, item.paletteId, item.dataEl]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(query));
		});
	}

	function isInventoryItemAdded(item) {
		return elements.some((element) => {
			return (
				element.inventoryId === item.inventoryId ||
				element.selector === item.selector ||
				element.selectors?.includes(item.selector)
			);
		});
	}

	function groupInventoryItems(items) {
		const groups = [];
		const groupsByLabel = new Map();

		items.forEach((item) => {
			const label = item.groupLabel || "Other elements";
			if (!groupsByLabel.has(label)) {
				const group = { label, items: [] };
				groupsByLabel.set(label, group);
				groups.push(group);
			}
			groupsByLabel.get(label).items.push(item);
		});

		return groups;
	}

	function activateInventoryGroup(label) {
		setActiveInventoryGroup(label);
		onInventoryHover?.(null);
	}

	function closeInventoryPicker() {
		setActivePickerRole(null);
		setActiveInventoryGroup(null);
		setInventorySearch("");
		onInventoryHover?.(null);
	}

	function handlePickerBlur(event) {
		if (event.currentTarget.contains(event.relatedTarget)) return;
		closeInventoryPicker();
	}

	function toggleRoleCollapse(roleKey) {
		setCollapsedRoles((prev) => ({ ...prev, [roleKey]: !prev[roleKey] }));
		if (activePickerRole === roleKey) closeInventoryPicker();
	}

	function getVisibleIntentLabel(role) {
		if (!role.isCustomSwatch) return "";
		const currentIntent = role.intent || role.inferredIntent || "auto";
		if (role.userLockedIntent && currentIntent !== "auto") {
			return INTENT_LABELS[currentIntent] || currentIntent;
		}
		const inferred = role.inferredIntent || role.intent || "auto";
		return inferred === "auto"
			? "Auto"
			: `Auto: ${INTENT_LABELS[inferred] || inferred}`;
	}

	function handleRoleIntentChange(roleKey, intent) {
		onChangeRoleIntent?.(roleKey, intent);
	}

	function handleRoleIntentImprove(roleKey) {
		onImproveRoleIntent?.(roleKey);
	}

	function renderInventoryPicker(role, filteredInventory, inventoryGroups) {
		const selectedInventoryGroup =
			inventoryGroups.find((group) => group.label === activeInventoryGroup) ||
			inventoryGroups[0];
		const direction = pickerDirections[role.key] || "down";
		const maxHeight = pickerMaxHeights[role.key] || 420;

		return (
			<div
				className={`kanban-inventory-picker open-${direction}`}
				style={{ "--picker-max-height": `${maxHeight}px` }}
				onMouseLeave={closeInventoryPicker}
				onBlur={handlePickerBlur}
				onKeyDown={(event) => {
					if (event.key === "Escape") closeInventoryPicker();
				}}
			>
				<input
					className="kanban-inventory-search"
					autoFocus
					value={inventorySearch}
					placeholder="Search preview elements"
					aria-label={`Search preview elements for ${role.label}`}
					onChange={(event) => setInventorySearch(event.target.value)}
				/>
				<div className="kanban-inventory-browser">
					<div className="kanban-inventory-categories">
						{filteredInventory.length === 0 && (
							<div className="kanban-inventory-empty">
								No matching preview elements.
							</div>
						)}
						{inventoryGroups.map((group) => {
							const isActive = group.label === selectedInventoryGroup?.label;
							return (
								<button
									type="button"
									className={`kanban-inventory-category ${isActive ? "active" : ""}`}
									key={group.label}
									onMouseEnter={() => activateInventoryGroup(group.label)}
									onFocus={() => activateInventoryGroup(group.label)}
									onClick={() => activateInventoryGroup(group.label)}
									aria-expanded={isActive}
								>
									<span>{group.label}</span>
									<span>{group.items.length}</span>
								</button>
							);
						})}
					</div>

					{selectedInventoryGroup && (
						<div
							className="kanban-inventory-side-list"
							role="group"
							aria-label={`${selectedInventoryGroup.label}, ${selectedInventoryGroup.items.length} elements`}
						>
							<div className="kanban-inventory-side-title">
								<span>{selectedInventoryGroup.label}</span>
								<span>{selectedInventoryGroup.items.length}</span>
							</div>
							{selectedInventoryGroup.items.map((item) => {
								const isAdded = isInventoryItemAdded(item);
								return (
									<button
										type="button"
										key={item.inventoryId}
										className="kanban-inventory-option"
										disabled={isAdded || !onAddInventoryElement}
										onMouseEnter={() => onInventoryHover?.(item)}
										onMouseLeave={() => onInventoryHover?.(null)}
										onFocus={() => onInventoryHover?.(item)}
										onBlur={() => onInventoryHover?.(null)}
										onClick={() => handleInventoryAdd(role.key, item)}
									>
										<span
											className="kanban-inventory-swatch"
											style={{ background: item.swatch }}
										/>
										<span className="kanban-inventory-copy">
											<span className="kanban-inventory-label">
												{item.label}
											</span>
											<span className="kanban-inventory-meta">
												{item.kind}
												{isAdded ? " · added" : ""}
											</span>
										</span>
									</button>
								);
							})}
						</div>
					)}
				</div>
				{inventoryErrors[role.key] && (
					<div className="kanban-add-error">{inventoryErrors[role.key]}</div>
				)}
			</div>
		);
	}

	return (
		<div className="kanban" aria-label="Grouped palette roles">
			{roles.map((role) => {
				const items = elements.filter((el) => el.role === role.key);
				const isPickerOpen = activePickerRole === role.key;
				const isCollapsed = Boolean(collapsedRoles[role.key]);
				const filteredInventory = isPickerOpen ? getFilteredInventory() : [];
				const inventoryGroups = groupInventoryItems(filteredInventory);
				const pickerDirection = pickerDirections[role.key] || "down";
				const inventoryPicker =
					isPickerOpen &&
					renderInventoryPicker(role, filteredInventory, inventoryGroups);
				const visibleIntentLabel = getVisibleIntentLabel(role);
				const isImprovingIntent = improvingRoleIntentId === role.key;
				const canAnalyzeIntent = Boolean(
					onImproveRoleIntent && canImproveRoleIntent && items.length > 0,
				);
				const improveTitle = !items.length
					? "Assign elements before screenshot analysis"
					: canImproveRoleIntent
						? "Analyze from selected screenshot"
						: "Select a generated variant first";

				return (
					<div
						key={role.key}
						className={`kanban-col kanban-col-${role.key} ${isCollapsed ? "collapsed" : ""} ${dragOverRole === role.key ? "drag-over" : ""}`}
						onDragOver={(e) => {
							e.preventDefault();
							setDragOverRole(role.key);
						}}
						onDragLeave={() => setDragOverRole(null)}
						onDrop={(e) => {
							e.preventDefault();
							setDragOverRole(null);
							if (draggingId) {
								onChangeRole(draggingId, role.key);
								setDraggingId(null);
							}
						}}
					>
						<div className="kanban-col-header">
							<button
								type="button"
								className="kanban-collapse-btn"
								onClick={() => toggleRoleCollapse(role.key)}
								aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${role.label}`}
								aria-expanded={!isCollapsed}
							>
								<i
									className={`ti ${isCollapsed ? "ti-chevron-right" : "ti-chevron-down"}`}
									aria-hidden="true"
								/>
							</button>
							<span className="kanban-dot" style={{ background: role.color }} />
							{editingRoleKey === role.key ? (
								<input
									className="kanban-role-rename-input"
									value={editingRoleLabel}
									autoFocus
									onChange={(event) => setEditingRoleLabel(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") saveRoleRename();
										if (event.key === "Escape") cancelRoleRename();
									}}
									onBlur={saveRoleRename}
								/>
							) : (
								<span
									className="kanban-col-name"
									title={
										role.isCustomSwatch
											? "Double-click to rename this custom color role"
											: undefined
									}
									onDoubleClick={() => startRoleRename(role)}
								>
									{role.label}
								</span>
							)}
							<span
								className="kanban-col-count"
								aria-label={`${items.length} ${items.length === 1 ? "group" : "groups"}`}
							>
								{items.length}
							</span>
						</div>

						{role.isCustomSwatch && !isCollapsed && (
							<div className="kanban-role-intent-row">
								<span
									className="kanban-role-intent-label"
									title={role.visualRationale || visibleIntentLabel}
								>
									{visibleIntentLabel}
								</span>
								<div className="kanban-role-intent-actions">
									<select
										className="kanban-role-intent-select"
										value={
											role.userLockedIntent ? role.intent || "auto" : "auto"
										}
										onChange={(event) =>
											handleRoleIntentChange(role.key, event.target.value)
										}
										aria-label={`Color behavior for ${role.label}`}
									>
										{CUSTOM_SWATCH_INTENT_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
									<button
										type="button"
										className="kanban-role-intent-improve"
										onClick={() => handleRoleIntentImprove(role.key)}
										disabled={isImprovingIntent || !canAnalyzeIntent}
										aria-label={`Analyze ${role.label} using selected variant screenshot`}
										title={improveTitle}
									>
										<i
											className={`ti ${isImprovingIntent ? "ti-loader-2" : "ti-sparkles"}`}
											aria-hidden="true"
										/>
									</button>
								</div>
							</div>
						)}

						{!isCollapsed && (
							<>
								<div className="kanban-col-items">
									{items.length === 0 && (
										<div className="kanban-empty">
											{role.emptyMessage || "drop elements here"}
										</div>
									)}
									{items.map((el) => {
										const isEditing = editingId === el.id;
										const removeLabel =
											el.role === "custom"
												? `Delete ${el.label}`
												: `Move ${el.label} to Exclude`;
										return (
											<div
												key={el.id}
												className="kanban-item"
												draggable={!isEditing}
												onDragStart={() => setDraggingId(el.id)}
												onDragEnd={() => setDraggingId(null)}
												onMouseEnter={() => onHover?.(el.id)}
												onMouseLeave={() => onHover?.(null)}
											>
												<span
													className="kanban-swatch"
													style={{ background: el.swatch }}
												/>
												{isEditing ? (
													<input
														className="kanban-rename-input"
														value={editingLabel}
														autoFocus
														onChange={(event) =>
															setEditingLabel(event.target.value)
														}
														onKeyDown={(event) => {
															if (event.key === "Enter") saveRename();
															if (event.key === "Escape") cancelRename();
														}}
														onBlur={cancelRename}
													/>
												) : (
													<span
														className="kanban-label"
														title={
															el.rationale ||
															el.selectors?.join(", ") ||
															el.selector ||
															"Double-click to rename"
														}
														onDoubleClick={() => startRename(el)}
													>
														{el.label}
														{Array.isArray(el.selectors) &&
															el.selectors.length > 1 && (
																<span className="kanban-match-count">
																	{el.selectors.length}
																</span>
															)}
													</span>
												)}

												<div className="kanban-item-actions">
													{el.isText && (
														<button
															type="button"
															className={`kanban-icon-btn ${el.textLocked ? "active" : ""}`}
															aria-label={`${el.textLocked ? "Unlock" : "Lock"} text color for ${el.label}`}
															aria-pressed={Boolean(el.textLocked)}
															onClick={(event) => {
																event.stopPropagation();
																onToggleTextLock?.(el.id);
															}}
														>
															<i
																className={`ti ${el.textLocked ? "ti-lock" : "ti-lock-open"}`}
																aria-hidden="true"
															/>
														</button>
													)}
													<button
														type="button"
														className="kanban-icon-btn danger"
														aria-label={removeLabel}
														title={removeLabel}
														onClick={(event) => {
															event.stopPropagation();
															onRemoveElement?.(el.id);
														}}
													>
														<i
															className={`ti ${el.role === "custom" ? "ti-trash" : "ti-x"}`}
															aria-hidden="true"
														/>
													</button>
													<i
														className="ti ti-grip-vertical kanban-grip"
														aria-hidden="true"
													/>
												</div>
											</div>
										);
									})}
								</div>

								{inventoryItems.length > 0 && (
									<div className="kanban-add-panel">
										{pickerDirection === "up" && inventoryPicker}
										<button
											type="button"
											className={`kanban-picker-toggle ${isPickerOpen ? "active" : ""}`}
											onClick={(event) => togglePicker(role.key, event)}
											aria-expanded={isPickerOpen}
											aria-label={`Pick preview element for ${role.label}`}
											title="Pick from preview"
										>
											<i className="ti ti-plus" aria-hidden="true" />
										</button>
										{pickerDirection !== "up" && inventoryPicker}
									</div>
								)}
							</>
						)}
					</div>
				);
			})}
		</div>
	);
}
