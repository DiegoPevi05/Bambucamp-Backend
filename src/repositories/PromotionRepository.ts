import { PrismaClient, Promotion   } from "@prisma/client";
import { PromotionDto, PromotionFilters, PaginatedPromotions, PromotionPublicDto, PromotionOptions } from "../dto/promotion";
import {BadRequestError, NotFoundError} from "../middleware/errors";
import {ReservePromotionDto} from "../dto/reserve";

const prisma = new PrismaClient();

interface Pagination {
  page: number;
  pageSize: number;
}

export const getAllPublicPromotions = async (): Promise<PromotionPublicDto[]> => {
  const promotions = await prisma.promotion.findMany({
    where: {
      status: 'ACTIVE'
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  const promotionPublicDtos = await Promise.all(promotions.map(async (promotion) => {
    const idTents = JSON.parse(promotion.idtents || '[]');
    const idProducts = JSON.parse(promotion.idproducts || '[]');
    const idExperiences = JSON.parse(promotion.idexperiences || '[]');

    const tents = await prisma.tent.findMany({
      where: {
        id: {
          in: idTents.id,
        },
      },
    });

    const products = await prisma.product.findMany({
      where: {
        id: {
          in: idProducts.id,
        },
      },
      include: {
        category: true, // Include the category object
      },
    });

    const experiences = await prisma.experience.findMany({
      where: {
        id: {
          in: idExperiences.id,
        },
      },
      include: {
        category: true, // Include the category object
      },
    });

    return {
      ...promotion,
      tents,
      products,
      experiences,
    } as PromotionPublicDto;
  }));

  return promotionPublicDtos;
};

export const getAllPromotionOptions = async():Promise<PromotionOptions> => {

  const tents =  await prisma.tent.findMany({
    where: {
      status: 'ACTIVE'
    }
  });

  const products =  await prisma.product.findMany({
    where: {
      status: 'ACTIVE'
    },
    include: {
      category: true, // Include the category object
    },
  });

  const experiences =  await prisma.experience.findMany({
    where: {
      status: 'ACTIVE'
    },
    include: {
      category: true, // Include the category object
    },
  });


  return {
    tents,
    products,
    experiences,
  }

}

export const getAllPromotions = async (filters:PromotionFilters, pagination:Pagination): Promise<PaginatedPromotions> => {

  const { title, status } = filters;
  const { page, pageSize } = pagination;
  
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  const totalCount = await prisma.promotion.count({
    where: {
      ...(title && { title: { contains: title, mode: 'insensitive' } }),
      ...(status && { status: { contains: status, mode: 'insensitive' } }),
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  const promotions = await prisma.promotion.findMany({
    where: {
      ...(title && { title: { contains: title, mode: 'insensitive' } }),
      ...(status && { status: { contains: status, mode: 'insensitive' } }),
    },
    orderBy: {
      createdAt: 'desc',
    },
    skip,
    take,
  });

  const promotionPublicDtos = await Promise.all(promotions.map(async (promotion) => {
    const idTents = JSON.parse(promotion.idtents || '[]');
    const idProducts = JSON.parse(promotion.idproducts || '[]');
    const idExperiences = JSON.parse(promotion.idexperiences || '[]');

    const tents = await prisma.tent.findMany({
      where: {
        id: {
          in: idTents.id,
        },
      },
    });

    const products = await prisma.product.findMany({
      where: {
        id: {
          in: idProducts.id,
        },
      },
      include: {
        category: true, // Include the category object
      },
    });

    const experiences = await prisma.experience.findMany({
      where: {
        id: {
          in: idExperiences.id,
        },
      },
      include: {
        category: true, // Include the category object
      },
    });

    return {
      ...promotion,
      tents,
      products,
      experiences,
    } as PromotionPublicDto;
  }));

  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    promotions: promotionPublicDtos,
    totalPages,
    currentPage: page,
  };

};

export const getPromotionById = async (id: number): Promise<Promotion | null> => {
  return await prisma.promotion.findUnique({
    where: { id }
  });
};

export const getPromotionsByIds = async (ids: number[]): Promise<Promotion[]> => {
  return await prisma.promotion.findMany({
    where: {
      id: {
        in: ids
      }
    }
  });
};

export const createPromotion = async (data: PromotionDto): Promise<Promotion> => {
  return await prisma.promotion.create({
    data
  });
};

export const updatePromotion = async (id:number, data: PromotionDto): Promise<Promotion> => {
  return await prisma.promotion.update({
    where: { id },
    data
  });
};

export const updatePromotionStock = async (id: number, newStock: number): Promise<Promotion> => {
  return await prisma.promotion.update({
    where: { id },
    data: {
      stock: newStock,
    },
  });
};

// Function to reduce stock for all promotions in ReservePromotion
export const reducePromotionStock = async (promotions: ReservePromotionDto[]): Promise<void> => {
  // Iterate over all promotions in data.promotions
  for (const promotion of promotions) {
    // Fetch the current promotion stock
    const currentPromotion = await prisma.promotion.findUnique({
      where: { id: promotion.idPromotion },
      select: { stock: true },
    });

    if (!currentPromotion) {
      throw new NotFoundError("error.noPromotionFoundInDB");
    }

    // Calculate the new stock after deducting the promotion's quantity
    const newStock = currentPromotion.stock - promotion.quantity;

    if (newStock < 0) {
      throw new BadRequestError("error.promotionIsOutOfStock");
    }

    // Update the promotion's stock
    await updatePromotionStock(promotion.idPromotion, newStock);
  }
};

export const deletePromotion = async (id: number): Promise<Promotion> => {
  return await prisma.promotion.delete({
    where: { id }
  });
};



export const updatePromotionImages = async (promotionId: number, images: string) => {
  try {
    await prisma.promotion.update({
      where: { id: promotionId },
      data: { images: images }
    });
  } catch (error) {
    throw new BadRequestError("error.noUpdateImages");
  }
};






