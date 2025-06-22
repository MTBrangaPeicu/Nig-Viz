import torch

def aggregate_nig(nig, sep_position, use_norm=False):
    detailed_agg = {}
    arch_agg = {}

    for key, nig_tensor in nig.items():
        nig_tensor = torch.tensor(nig_tensor)
        L = nig_tensor.size(-1) if len(nig_tensor.shape) == 3 else nig_tensor.size(0)

        # Token masks
        cls_mask     = torch.zeros(L, dtype=torch.bool); cls_mask[0] = True
        query_mask   = torch.zeros(L, dtype=torch.bool); query_mask[1:sep_position] = True
        sep1_mask    = torch.zeros(L, dtype=torch.bool); sep1_mask[sep_position] = True
        passage_mask = torch.zeros(L, dtype=torch.bool); passage_mask[sep_position + 1:-1] = True
        sep2_mask    = torch.zeros(L, dtype=torch.bool); sep2_mask[-1] = True
        masks = [cls_mask, query_mask, sep1_mask, passage_mask, sep2_mask]

        if len(nig_tensor.shape) == 3:  # ATTN: [12, T, T]
            full = []  # for Subset B: [12, 5, 5]
            arch = torch.zeros(5, 5)  # for Subset A: [5, 5]
            for i, src_mask in enumerate(masks):
                row = []
                for j, tgt_mask in enumerate(masks):
                    sub = nig_tensor[:, src_mask, :][:, :, tgt_mask]  # [12, s, t]
                    if sub.numel() == 0:
                        agg = torch.zeros(nig_tensor.size(0))  # [12]
                    else:
                        agg = torch.norm(sub, p=2, dim=(1, 2)) if use_norm else torch.sum(sub, dim=(1, 2))
                    row.append(agg)  # List of [12]
                    arch[i, j] = torch.mean(agg)  # Avg across 12 heads
                full.append(torch.stack(row, dim=1))  # [12, 5]
            full_tensor = torch.stack(full, dim=1)  # [12, 5, 5]
            detailed_agg[key] = full_tensor.numpy()
            arch_agg[key] = arch.numpy()

        elif len(nig_tensor.shape) == 2:  # FFN: [T, 1536]
            rows = []
            arch_vals = []
            for mask in masks:
                masked = nig_tensor[mask, :]
                if masked.numel() == 0:
                    agg = torch.zeros(nig_tensor.size(1))
                else:
                    agg = torch.norm(masked, p=2, dim=0) if use_norm else torch.sum(masked, dim=0)
                rows.append(agg)  # [1536]
                arch_vals.append(torch.sum(agg))  # scalar
            detailed_agg[key] = torch.stack(rows, dim=0).numpy()  # [5, 1536]
            arch_agg[key] = torch.tensor(arch_vals).numpy()  # [5]

    return arch_agg, detailed_agg
