import { PrismaClient, Reserve, ReserveTent, ReserveProduct, ReserveExperience, Tent, ReserveStatus,   } from "@prisma/client";
import { ReserveDto, ReserveFilters, PaginatedReserve, ReserveTentDto, ReserveExperienceDto, ReserveProductDto, ReserveOptions, ReservePromotionDto, createReserveProductDto, createReserveExperienceDto } from "../dto/reserve";
import * as utils from "../lib/utils";
import {NotFoundError} from "../middleware/errors";

interface Pagination {
  page: number;
  pageSize: number;
}

export interface ExtendedReserve extends Reserve {
  tents: ReserveTent[];
  products: ReserveProduct[];
  experiences: ReserveExperience[];
}

const prisma = new PrismaClient();

export const searchAvailableTents = async (dateFrom: Date, dateTo: Date): Promise<Tent[]> => {
  // Find all reserved tent IDs within the date range
  const reservedTentIds = await prisma.reserveTent.findMany({
    where: {
      AND: [
        {
          dateFrom: {
            lte: dateTo,
          },
        },
        {
          dateTo: {
            gte: dateFrom,
          },
        },
        {
          reserve: {
            reserve_status: {
              in: [ReserveStatus.CONFIRMED, ReserveStatus.NOT_CONFIRMED],
            },
          },
        },
      ],
    },
    select: {
      idTent: true,
    },
  });

  // Extract unique tent IDs
  const reservedTentIdSet = new Set(reservedTentIds.map(rt => rt.idTent));

  // Fetch all tents that are ACTIVE and not reserved
  const tents = await prisma.tent.findMany({
    where: {
      status: 'ACTIVE',
      id: {
        not: {
          in: Array.from(reservedTentIdSet),
        },
      },
    },
  });

  return tents;
};

export const getCalendarDates = async (page: number): Promise<{ date: Date, label: string, available: boolean }[]> => {
  const currentDate = new Date();
  const targetDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + page);
  const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);

  const datesInMonth: { date: Date, label: string, available: boolean }[] = [];

  // Fetch all active tents
  const activeTents = await prisma.tent.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  const activeTentIds = activeTents.map(tent => tent.id);

  // Loop through each day of the month
  for (let day = 1; day <= endOfMonth.getDate(); day++) {
    const date = new Date(targetDate.getFullYear(), targetDate.getMonth(), day);

    // Skip past dates
    if (date < currentDate) {
      datesInMonth.push({ date, label: date.toDateString(), available: false });
      continue;
    }

    // Fetch reservations for the specific date
    const reservedTents = await prisma.reserveTent.findMany({
      where: {
        dateFrom: { lte: date },
        dateTo: { gte: date },
      },
      select: { idTent: true },
    });

    const reservedTentIds = reservedTents.map(reserveTent => reserveTent.idTent);
    
    // Check if all active tents are reserved on this date
    const allReserved = activeTentIds.every(tentId => reservedTentIds.includes(tentId));
    const available = !allReserved;

    datesInMonth.push({
      date,
      label: date.toDateString(),
      available,
    });
  }

  return datesInMonth;
};

export const getMyReservesByMonth = async (page: number, userId?: number): Promise<{ reserves: { id:number, external_id:string, dateFrom:Date, dateTo:Date }[] }> => {
  const currentDate = new Date();

  // Calculate the target month and year based on the page
  const targetDate = new Date(currentDate.setMonth(currentDate.getMonth() + page));
  const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1, 0, 0, 0);
  const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 23, 59, 59);
  const reserveTents = await prisma.reserveTent.findMany({
    where: {
      reserve: {
        ...(userId && { userId: userId }), // Filter by userId if provided
      },
      AND: [
        {
          dateFrom: { lte: endOfMonth },  // Ensure the reserveTent's dateFrom is within the range
        },
        {
          dateTo: { gte: startOfMonth },  // Ensure the reserveTent's dateTo is within the range
        },
      ],
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      reserve: {
        select: {
          external_id: true, // Ensure external_id is selected
        },
      },
      dateFrom: true,
      dateTo: true,
      reserveId:true
    },
  });

  const formattedReserves = reserveTents.map(reserveTent => ({
    id: reserveTent.reserveId,
    external_id:reserveTent.reserve.external_id,
    dateFrom: reserveTent.dateFrom,
    dateTo: reserveTent.dateTo,
  }));

  return {
    reserves:formattedReserves,
  };
};

export const getMyReserves = async (pagination: Pagination, userId?: number): Promise<PaginatedReserve> => {
  const { page, pageSize } = pagination;
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  // Get the total count of reserves for the user
  const totalCount = await prisma.reserve.count({
    where: {
      ...(userId && { userId: userId }),
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  const reserves = await prisma.reserve.findMany({
    where: {
      ...(userId && { userId: userId }),
    },
    orderBy: {
      createdAt: 'desc',
    },
    skip,
    take,
    include: {
      tents: true,
      products: true,
      experiences: true,
      promotions:true,
    },
  });

  const enrichedReserves = await Promise.all(
    reserves.map(async (reserve) => {
      const tentIds = reserve.tents.map((t) => t.idTent);
      const productIds = reserve.products.map((p) => p.idProduct);
      const experienceIds = reserve.experiences.map((e) => e.idExperience);
      const promotionIds = reserve.promotions.map((e) => e.idPromotion);

      const tentsDB = await prisma.tent.findMany({
        where: {
          id: { in: tentIds },
        },
      });

      const productsDB = await prisma.product.findMany({
        where: {
          id: { in: productIds },
        },
      });

      const experiencesDB = await prisma.experience.findMany({
        where: {
          id: { in: experienceIds },
        },
      });

      const promotionsDB = await prisma.promotion.findMany({
        where: {

          id: { in: promotionIds },
        },
      });

      return {
        ...reserve,
        tents: reserve.tents.map((tent) => ({
          ...tent,
          tentDB: tentsDB.find((dbTent) => dbTent.id === tent.idTent),
          promotionId: tent.promotionId ?? undefined,  // Handle null -> undefined conversion
        })),
        products: reserve.products.map((product) => ({
          ...product,
          productDB: productsDB.find((dbProduct) => dbProduct.id === product.idProduct),
          promotionId: product.promotionId ?? undefined,  // Handle null -> undefined conversion
        })),
        experiences: reserve.experiences.map((experience) => ({
          ...experience,
          experienceDB: experiencesDB.find((dbExperience) => dbExperience.id === experience.idExperience),
          promotionId: experience.promotionId ?? undefined,  // Handle null -> undefined conversion
        })),
        promotions: reserve.promotions.map((promotion) => ({
          ...promotion,
          promotionDB: promotionsDB.find((dbPromotion) => dbPromotion.id === promotion.idPromotion),
        })),
      };
    })
  );

  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    reserves: enrichedReserves,
    totalPages,
    currentPage: page,
  };
};

export const getAllReserveOptions = async():Promise<ReserveOptions> => {

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

  const promotions = await prisma.promotion.findMany({
    where:{
      status:'ACTIVE'
    },
  })

  const discounts = await prisma.discountCode.findMany({
    where:{
      status:'ACTIVE'
    },
  })

  return {
    tents,
    products,
    experiences,
    promotions,
    discounts
  }

}

export const getReserveDtoById = async(reserveId:number):Promise<ReserveDto|null> => {
  // Retrieve all Reserve records matching the IDs
  const reserve = await prisma.reserve.findUnique({
    where: {
      id: reserveId ,
    },
    include: {
      tents: {
        where: {
          OR: [
            { promotionId: null },     // Fetch tents with null promotionId
            { promotionId: undefined }, // Fetch tents with undefined promotionId (though undefined is often unnecessary in Prisma)
          ],
        },
      },
      products: {
        where: {
          OR: [
            { promotionId: null },     // Fetch products with null promotionId
            { promotionId: undefined }, // Fetch products with undefined promotionId
          ],
        },
      },
      experiences: {
        where: {
          OR: [
            { promotionId: null },     // Fetch experiences with null promotionId
            { promotionId: undefined }, // Fetch experiences with undefined promotionId
          ],
        },
      },
      promotions: true,
      user:true,
    }
  });

  if(!reserve) return null;
  // Map over the reserves to ensure the data types match your DTO structure
  const enrichedReserve = ({
    ...reserve,
    user_name: reserve.user.firstName,
    user_email: reserve.user.email,
    tents: reserve.tents.map((tent) => ({
      ...tent,
      promotionId: tent.promotionId ?? undefined,  // Convert null to undefined for compatibility
    })),
    products: reserve.products.map((product) => ({
      ...product,
      promotionId: product.promotionId ?? undefined,  // Convert null to undefined
    })),
    experiences: reserve.experiences.map((experience) => ({
      ...experience,
      promotionId: experience.promotionId ?? undefined,  // Convert null to undefined
    })),
    promotions: reserve.promotions.map((promotion) => ({
      ...promotion,
    })),
  });

  return enrichedReserve;

}


export const getAllReserves = async ( filters: ReserveFilters, pagination: Pagination): Promise<PaginatedReserve> => {
  const { dateFrom, dateTo, payment_status } = filters;
  const { page, pageSize } = pagination;

  const skip = (page - 1) * pageSize;
  const take = pageSize;

 // Find ReserveTent records within the date range
  const reservedTents = await prisma.reserveTent.findMany({
    where: {
      ...(dateFrom && { dateFrom: { lte: dateTo } }), // Ensure dateFrom is within the range
      ...(dateTo && { dateTo: { gte: dateFrom } }),   // Ensure dateTo is within the range
      ...(payment_status && {
        reserve: {
          payment_status: payment_status,
        },
      }),
    },
    skip,
    take,
    include: {
      reserve: true,   // Include related Reserve data
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  // Extract reserve IDs to filter the Reserve records
  const reserveIds = [...new Set(reservedTents.map(tent => tent.reserveId))]; 

  const totalCount = reserveIds.length;

  // Retrieve all Reserve records matching the IDs
  const reserves = await prisma.reserve.findMany({
    where: {
      id: { in: reserveIds },
    },
    include: {
      tents: {
        where: {
          OR: [
            { promotionId: null },     // Fetch tents with null promotionId
            { promotionId: undefined }, // Fetch tents with undefined promotionId (though undefined is often unnecessary in Prisma)
          ],
        },
      },
      products: {
        where: {
          OR: [
            { promotionId: null },     // Fetch products with null promotionId
            { promotionId: undefined }, // Fetch products with undefined promotionId
          ],
        },
      },
      experiences: {
        where: {
          OR: [
            { promotionId: null },     // Fetch experiences with null promotionId
            { promotionId: undefined }, // Fetch experiences with undefined promotionId
          ],
        },
      },
      promotions: true,
      user:true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  // Map over the reserves to ensure the data types match your DTO structure
  const enrichedReserves = reserves.map((reserve) => ({
    ...reserve,
    user_name: reserve.user.firstName,
    user_email: reserve.user.email,
    tents: reserve.tents.map((tent) => ({
      ...tent,
      promotionId: tent.promotionId ?? undefined,  // Convert null to undefined for compatibility
    })),
    products: reserve.products.map((product) => ({
      ...product,
      promotionId: product.promotionId ?? undefined,  // Convert null to undefined
    })),
    experiences: reserve.experiences.map((experience) => ({
      ...experience,
      promotionId: experience.promotionId ?? undefined,  // Convert null to undefined
    })),
    promotions: reserve.promotions.map((promotion) => ({
      ...promotion,
    })),
  }));

  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    reserves: enrichedReserves,  // Return the enriched reserves
    totalPages,
    currentPage: page,
  };
};

export const getReserveById = async (id: number): Promise<Reserve | null> => {
  return await prisma.reserve.findUnique({
    where: { id }
  });
};


export const createReserve = async (data: ReserveDto): Promise<ReserveDto | null> => {
  // Ensure userId is defined, otherwise throw an error or handle appropriately
  if (!data.userId) {
    throw new NotFoundError('error.noUserFoundInDB');
  }

  const confirmed =  data.reserve_status != ReserveStatus.NOT_CONFIRMED
  // Prepare the data for Prisma
  const reserveData = {
    userId: data.userId,  // Ensure this is a valid number
    external_id: "IN_PROCESS",  // Placeholder for external_id
    dateSale: data.dateSale,
    price_is_calculated: data.price_is_calculated,
    discount_code_id: data.discount_code_id,
    discount_code_name: data.discount_code_name,
    net_import: data.net_import,
    discount: data.discount,
    gross_import: data.gross_import,
    canceled_reason: data.canceled_reason,
    canceled_status: data.canceled_status,
    payment_status: data.payment_status,
    reserve_status: data.reserve_status,
    eta:data.eta,
    tents: {
      create: data.tents.map(tent => ({
        idTent: tent.idTent,
        name: tent.name,
        price: tent.price,
        nights: tent.nights,
        dateFrom: tent.dateFrom,
        dateTo: tent.dateTo,
        aditionalPeople: tent.aditionalPeople,
        aditionalPeoplePrice:tent.aditionalPeoplePrice,
        confirmed: confirmed,
        promotionId: tent.promotionId ?? undefined,  // Handle optional promotionId
      }))
    },
    products: {
      create: data.products.map(product => ({
        idProduct: product.idProduct,
        name: product.name,
        price: product.price,
        quantity: product.quantity,
        confirmed: confirmed,
        promotionId: product.promotionId ?? undefined,  // Handle optional promotionId
      }))
    },
    experiences: {
      create: data.experiences.map(experience => ({
        idExperience: experience.idExperience,
        name: experience.name,
        price: experience.price,
        quantity: experience.quantity,
        day: experience.day,
        confirmed: confirmed,
        promotionId: experience.promotionId ?? undefined,  // Handle optional promotionId
      }))
    },
    promotions: {
      create: data.promotions.map(promotion => ({
        idPromotion: promotion.idPromotion,
        name: promotion.name,
        price: promotion.price,
        quantity: promotion.quantity,
        confirmed: confirmed,
      }))
    }
  };

  // Create the reserve in the database
  const createdReserve = await prisma.reserve.create({
    data: reserveData,
  });

  // Generate the external_id based on the reserve's internal ID
  const externalId = utils.generateExternalId(createdReserve.id);

  // Update the reserve with the generated external_id
  await prisma.reserve.update({
    where: { id: createdReserve.id },
    data: { external_id: externalId },
  });

  // Fetch the newly created reserve with related data
  const reserve = await prisma.reserve.findUnique({
    where: { id: createdReserve.id },
    include: {
      tents: true,
      products: true,
      experiences: true,
      promotions: true,
    },
  });

  // If reserve exists, map over related data to ensure compatibility with your DTO
  if (reserve) {
    const enrichedReserve: ReserveDto = {
      ...reserve,
      id:createdReserve.id,
      tents: reserve.tents.map(tent => ({
        ...tent,
        promotionId: tent.promotionId ?? undefined,  // Handle null values
      })),
      products: reserve.products.map(product => ({
        ...product,
        promotionId: product.promotionId ?? undefined,  // Handle null values
      })),
      experiences: reserve.experiences.map(experience => ({
        ...experience,
        promotionId: experience.promotionId ?? undefined,  // Handle null values
      })),
      promotions: reserve.promotions.map(promotion => ({
        ...promotion,
      }))
    };

    return enrichedReserve;
  }

  return null;
};

export const AddProductReserve = async (data: createReserveProductDto[]): Promise<ReserveProduct[]> => {

  const createdProducts: ReserveProduct[] = [];

  for (const productData of data) {
    const createdProduct = await prisma.reserveProduct.create({
      data: {
        reserveId: productData.reserveId,
        idProduct: productData.idProduct,
        name: productData.name,
        price: productData.price,
        quantity: productData.quantity,
        confirmed: productData.confirmed,
      },
    });
    createdProducts.push(createdProduct);
  }

  return createdProducts;
};

export const updateProductReserve = async(id:number, confirmed:boolean):Promise<ReserveProduct> => {
  return await prisma.reserveProduct.update({
    where: { id },
    data:{ confirmed }
  });
}

export const deleteProductReserve = async(id:number):Promise<ReserveProduct> => {
  return await prisma.reserveProduct.delete({
    where: { id }
  });
}

export const AddExperienceReserve = async(data: createReserveExperienceDto[]): Promise<ReserveExperience[]> => {
  const createdExperiences: ReserveExperience[] = [];

  for (const experienceData of data) {
    const createdExperience = await prisma.reserveExperience.create({
      data: {
        reserveId: experienceData.reserveId,
        idExperience: experienceData.idExperience,
        name: experienceData.name,
        day: experienceData.day,
        price: experienceData.price,
        quantity: experienceData.quantity,
        confirmed: experienceData.confirmed,
      },
    });
    createdExperiences.push(createdExperience);
  }

  return createdExperiences;
};

export const updateExperienceReserve = async(id:number, confirmed:boolean):Promise<ReserveExperience> => {
  return await prisma.reserveExperience.update({
    where: { id },
    data:{ confirmed }
  });
}

export const deleteExperienceReserve = async(id:number):Promise<ReserveExperience> => {
  return await prisma.reserveExperience.delete({
    where: { id }
  });
}



export const getAvailableReserves = async (tents: ReserveTentDto[]): Promise<{ reserveId: number; idTent: number }[]> => {
  // Extract tent IDs and filter out any undefined values
  const tentIds = tents.map(tent => tent.idTent).filter((id): id is number => id !== undefined);

  // Prepare the query to find overlapping reservations
  return await prisma.reserveTent.findMany({
    where: {
      idTent: {
        in: tentIds,
      },
      AND: tents.flatMap(tent => [
        {
          dateFrom: {
            lt: tent.dateTo, // Check if the reservation ends after the tent's check-in
          },
        },
        {
          dateTo: {
            gt: tent.dateFrom, // Check if the reservation starts before the tent's check-out
          },
        },
      ]),
    },
    select: {
      reserveId: true,
      idTent: true,
    },
  });
};

export const upsertReserveDetails = async (
  idReserve: number,
  tents: ReserveTentDto[],
  products: ReserveProductDto[],
  experiences: ReserveExperienceDto[],
  promotions:ReservePromotionDto[]
) => {
  // Delete existing tents associated with the reserve
  await prisma.reserveTent.deleteMany({
    where: { reserveId: idReserve },
  });

  // Delete existing products associated with the reserve
  await prisma.reserveProduct.deleteMany({
    where: { reserveId: idReserve },
  });

  // Delete existing experiences associated with the reserve
  await prisma.reserveExperience.deleteMany({
    where: { reserveId: idReserve },
  });

  await prisma.reservePromotion.deleteMany({
    where: { reserveId: idReserve },
  });

  // Create new tents
  await prisma.reserveTent.createMany({
    data: tents.map((tent) => ({
      idTent: tent.idTent,
      dateFrom: tent.dateFrom,
      dateTo:tent.dateTo,
      name: tent.name,
      price: tent.price,
      nights: tent.nights,
      aditionalPeople:tent.aditionalPeople,
      aditionalPeoplePrice:tent.aditionalPeoplePrice,
      reserveId: idReserve, // Establish the relationship
      promotionId: tent.promotionId ?? undefined,  // Handle optional promotionId
    })),
  });

  // Create new products
  await prisma.reserveProduct.createMany({
    data: products.map((product) => ({
      idProduct: product.idProduct,
      name: product.name,
      price: product.price,
      quantity: product.quantity,
      reserveId: idReserve, // Establish the relationship
      promotionId: product.promotionId ?? undefined,  // Handle optional promotionId
    })),
  });

  // Create new experiences
  await prisma.reserveExperience.createMany({
    data: experiences.map((experience) => ({
      idExperience: experience.idExperience,
      name: experience.name,
      price: experience.price,
      quantity: experience.quantity,
      day:experience.day,
      reserveId: idReserve, // Establish the relationship
      promotionId: experience.promotionId ?? undefined,  // Handle optional promotionId
    })),
  });

  // Create new experiences
  await prisma.reservePromotion.createMany({
    data: promotions.map((promotion) => ({
      idPromotion: promotion.idPromotion,
      name: promotion.name,
      price: promotion.price,
      quantity: promotion.quantity,
      reserveId: idReserve, // Establish the relationship
    })),
  });

  // Optionally, return the updated reserve with related entities
  return await prisma.reserve.findUnique({
    where: { id: idReserve },
    include: {
      tents: true,
      products: true,
      experiences: true,
      promotions:true,
    },
  });
};

export const updateReserve = async (id:number, data: Reserve): Promise<Reserve> => {
  return await prisma.reserve.update({
    where: { id },
    data
  });
};

export const deleteReserve = async (id: number): Promise<Reserve> => {
  return await prisma.reserve.delete({
    where: { id }
  });
};


export const confirmReserve = async (reserveId: number): Promise<void> => {
  // Update all related tents, products, experiences, promotions to confirmed
  await prisma.reserve.update({
    where: { id: reserveId },
    data: {
      reserve_status: ReserveStatus.CONFIRMED,
      tents: {
        updateMany: { data: { confirmed: true }, where: { reserveId } }
      },
      products: {
        updateMany: { data: { confirmed: true }, where: { reserveId } }
      },
      experiences: {
        updateMany: { data: { confirmed: true }, where: { reserveId } }
      },
      promotions: {
        updateMany: { data: { confirmed: true }, where: { reserveId } }
      }
    }
  });
};

export const confirmTent = async (reserveTentId: number): Promise<void> => {
  // Ensure the tent belongs to the provided reserveId before updating
  const tent = await prisma.reserveTent.findFirst({
    where: { id: reserveTentId }
  });

  if (!tent) {
    throw new NotFoundError('error.noTentFoundInDB');
  }

  // Update the tent to confirmed
  await prisma.reserveTent.update({
    where: { id: reserveTentId },
    data: { confirmed: true }
  });
};

export const confirmProduct = async (reserveProductId: number): Promise<void> => {
  // Ensure the product belongs to the provided reserveId before updating
  const product = await prisma.reserveProduct.findFirst({
    where: { id: reserveProductId }
  });

  if (!product) {
    throw new NotFoundError('error.noProductFoundInDB');
  }

  // Update the product to confirmed
  await prisma.reserveProduct.update({
    where: { id: reserveProductId },
    data: { confirmed: true }
  });
};

export const confirmExperience = async (reserveExperienceId: number): Promise<void> => {
  // Ensure the experience belongs to the provided reserveId before updating
  const experience = await prisma.reserveExperience.findFirst({
    where: { id: reserveExperienceId }
  });

  if (!experience) {
    throw new NotFoundError('error.noExperienceFoundInDB');
  }

  // Update the experience to confirmed
  await prisma.reserveExperience.update({
    where: { id: reserveExperienceId },
    data: { confirmed: true }
  });
};

export const confirmPromotion = async (reservePromotionId: number): Promise<void> => {
  // Ensure the promotion belongs to the provided reserveId before updating
  const promotion = await prisma.reservePromotion.findFirst({
    where: { id: reservePromotionId }
  });

  if (!promotion) {
    throw new NotFoundError('error.noPromotionFoundInDB');
  }

  // Update the promotion to confirmed
  await prisma.reservePromotion.update({
    where: { id: reservePromotionId },
    data: { confirmed: true }
  });
};

interface SalesFilters {
  step: "W"|"M"|"Y";
  type:"A"|"P";
}

export const getNetSalesStatistics = async (filters: SalesFilters, language:string): Promise<{ date: string; amount: number }[]> => {
  const { step, type } = filters;
  const today = new Date();
  let startDate: Date | undefined;

  if (step === "W") {
    // Weekly - Last 7 days
    startDate = new Date(today);
    startDate.setDate(today.getDate() - 7);
  } else if (step === "M") {
    // Monthly - Last 5 weeks
    startDate = new Date(today);
    startDate.setDate(today.getDate() - (7 * 5));
  } else if (step === "Y") {
    // Yearly - Last 12 months
    startDate = new Date(today);
    startDate.setFullYear(today.getFullYear() - 1);
  }

  const reservedTentIds = await prisma.reserveTent.findMany({
    where: {
      AND: [
        {
          dateFrom: {
            lte: startDate,
          },
        },
        {
          dateTo: {
            gte: today,
          },
        },
        {
          reserve: {
            reserve_status: {
              in: ["COMPLETE"],
            },
          },
        },
      ],
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      reserve: {
        select: {
          net_import: true, // Ensure external_id is selected
        },
      },
      reserveId:true,
      dateFrom: true,
      dateTo: true,
    },
  });

  // Aggregate the latest dateFrom per reserveId
  const reserveMap: Record<string, { dateFrom: Date; net_import: number }> = {};

  reservedTentIds.forEach(({ reserveId, dateFrom, reserve }) => {
    if (
      !reserveMap[reserveId] || 
      reserveMap[reserveId].dateFrom > dateFrom
    ) {
      reserveMap[reserveId] = {
        dateFrom,
        net_import: reserve?.net_import || 0,
      };
    }
  });

  // Convert the dictionary to an array of objects
  const reservesWithLatestDate = Object.entries(reserveMap).map(([reserveId, data]) => ({
    reserveId,
    dateFrom: data.dateFrom,
    net_import: data.net_import,
  }));

  // Aggregate results based on the step
  let salesData: { date: string; amount: number }[] = [];

  if (step === "W") {
    // Group by day for the last 7 days
    const dailyData: Record<string, number> = {};
    for (const reserve of reservesWithLatestDate) {
      const dateKey = reserve.dateFrom.toISOString().slice(0, 10); // YYYY-MM-DD
      dailyData[dateKey] = (dailyData[dateKey] || 0) + reserve.net_import;
    }

    // Generate the last 7 days with a default quantity of 0
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateKey = date.toISOString().slice(0, 10);
      return { date: dateKey, amount: 0 };
    });

    weekDays.forEach(day => {
      if (dailyData[day.date]) {
        day.amount = dailyData[day.date];
      }
    });

    if (type === "P") {
      salesData = weekDays;
    } else {
      let accumulatedAmount = 0;
      for (const day of weekDays) {
        accumulatedAmount += day.amount;
        salesData.push({ date: day.date, amount: accumulatedAmount });
      }
    }

  } else if (step === "M") {
    // Group by week for the last 5 weeks
    let currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - today.getDay()); // Start of current week (Sunday)
    
    const weekIntervals = [];
    for (let i = 0; i < 5; i++) {
      const weekEnd = new Date(currentWeekStart); // End of the current week
      const weekStart = new Date(currentWeekStart);
      weekStart.setDate(weekStart.getDate() - 6); // Start of the week (7-day range)

      weekIntervals.push({ start: new Date(weekStart), end: new Date(weekEnd) });

      // Move back one week
      currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    }

    let accumulatedAmount = 0;
    for (const { start, end } of weekIntervals) {
      const weeklyAmount = reservesWithLatestDate
        .filter(reserve => reserve.dateFrom >= start && reserve.dateFrom <= end)
        .reduce((sum, reserve) => sum + reserve.net_import, 0);

      const dateLabel = `${start.toISOString().slice(0, 10)}`;

      if (type === "A") {
            accumulatedAmount += weeklyAmount;
            salesData.push({ date: dateLabel, amount: accumulatedAmount });
          } else {
            salesData.push({ date: dateLabel, amount: weeklyAmount });
          }
      }
  } else if (step === "Y") {
    // Group by month for the last 12 months
    const monthIntervals = [];
    let currentMonth = new Date(today);
    currentMonth.setDate(1); // Set to the first day of the current month

    for (let i = 0; i < 12; i++) {
      const monthStart = new Date(currentMonth);
      const monthEnd = new Date(currentMonth);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0); // Last day of the current month

      monthIntervals.push({ start: new Date(monthStart), end: new Date(monthEnd) });

      currentMonth.setMonth(currentMonth.getMonth() - 1); // Move back one month
    }

    let accumulatedAmount = 0;
    for (const { start, end } of monthIntervals) {
      const monthlyAmount = reservesWithLatestDate
        .filter(reserve => reserve.dateFrom >= start && reserve.dateFrom <= end)
        .reduce((sum, reserve) => sum + reserve.net_import, 0);

      const dateLabel = start.toLocaleString('default', { month: 'long' });

      if (type === "A") {
        accumulatedAmount += monthlyAmount;
        salesData.push({ date: dateLabel, amount: accumulatedAmount });
      } else {
        salesData.push({ date: dateLabel, amount: monthlyAmount });
      }
    }
  }

  return salesData.reverse(); // Reverse to order from oldest to newest
};


export const getReserveQuantityStatistics = async (filters: SalesFilters, language:string): Promise<{ date: string; quantity: number }[]> => {
  const { step, type } = filters;
  const today = new Date();
  let startDate: Date | undefined;

  if (step === "W") {
    startDate = new Date(today);
    startDate.setDate(today.getDate() - 7); // Weekly - Last 7 days
  } else if (step === "M") {
    startDate = new Date(today);
    startDate.setDate(today.getDate() - (7 * 5)); // Monthly - Last 5 weeks
  } else if (step === "Y") {
    startDate = new Date(today);
    startDate.setFullYear(today.getFullYear() - 1); // Yearly - Last 12 months
  }

  const reservedTentIds = await prisma.reserveTent.findMany({
    where: {
      AND: [
        {
          dateFrom: {
            lte: startDate,
          },
        },
        {
          dateTo: {
            gte: today,
          },
        },
        {
          reserve: {
            reserve_status: {
              in: ["COMPLETE"],
            },
          },
        },
      ],
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      reserveId: true,
      dateFrom: true,
      dateTo: true,
    },
  });

  // Aggregate the latest dateFrom per reserveId
  const reserveMap: Record<string, Date> = {};

  reservedTentIds.forEach(({ reserveId, dateFrom }) => {
    if (!reserveMap[reserveId] || reserveMap[reserveId] > dateFrom) {
      reserveMap[reserveId] = dateFrom;
    }
  });

  const reservesWithLatestDate = Object.entries(reserveMap).map(([reserveId, dateFrom]) => ({
    reserveId,
    dateFrom,
  }));

  let quantityData: { date: string; quantity: number }[] = [];

  if (step === "W") {
    const dailyData: Record<string, number> = {};
    for (const reserve of reservesWithLatestDate) {
      const dateKey = reserve.dateFrom.toISOString().slice(0, 10);
      dailyData[dateKey] = (dailyData[dateKey] || 0) + 1;
    }

    // Generate the last 7 days with a default quantity of 0
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateKey = date.toISOString().slice(0, 10);
      return { date: dateKey, quantity: 0 };
    });

    weekDays.forEach(day => {
      if (dailyData[day.date]) {
        day.quantity = dailyData[day.date];
      }
    });

    if (type === "P") {
      quantityData = weekDays;
    } else {
      let accumulatedQuantity = 0;
      for (const day of weekDays) {
        accumulatedQuantity += day.quantity;
        quantityData.push({ date: day.date, quantity: accumulatedQuantity });
      }
    }

  } else if (step === "M") {
    let currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - today.getDay());

    const weekIntervals = [];
    for (let i = 0; i < 5; i++) {
      const weekEnd = new Date(currentWeekStart);
      const weekStart = new Date(currentWeekStart);
      weekStart.setDate(weekStart.getDate() - 6);

      weekIntervals.push({ start: new Date(weekStart), end: new Date(weekEnd) });
      currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    }

    let accumulatedQuantity = 0;
    for (const { start, end } of weekIntervals) {
      const weeklyQuantity = reservesWithLatestDate
        .filter(reserve => reserve.dateFrom >= start && reserve.dateFrom <= end)
        .length;

      const dateLabel = `${start.toISOString().slice(0, 10)}`;

      if (type === "A") {
        accumulatedQuantity += weeklyQuantity;
        quantityData.push({ date: dateLabel, quantity: accumulatedQuantity });
      } else {
        quantityData.push({ date: dateLabel, quantity: weeklyQuantity });
      }
    }
  } else if (step === "Y") {
    const monthIntervals = [];
    let currentMonth = new Date(today);
    currentMonth.setDate(1);

    for (let i = 0; i < 12; i++) {
      const monthStart = new Date(currentMonth);
      const monthEnd = new Date(currentMonth);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0);

      monthIntervals.push({ start: new Date(monthStart), end: new Date(monthEnd) });
      currentMonth.setMonth(currentMonth.getMonth() - 1);
    }

    let accumulatedQuantity = 0;
    for (const { start, end } of monthIntervals) {
      const monthlyQuantity = reservesWithLatestDate
        .filter(reserve => reserve.dateFrom >= start && reserve.dateFrom <= end)
        .length;

      const dateLabel = start.toLocaleString(language || 'default', { month: 'long' });

      if (type === "A") {
        accumulatedQuantity += monthlyQuantity;
        quantityData.push({ date: dateLabel, quantity: accumulatedQuantity });
      } else {
        quantityData.push({ date: dateLabel, quantity: monthlyQuantity });
      }
    }
  }

  return quantityData.reverse();
};
